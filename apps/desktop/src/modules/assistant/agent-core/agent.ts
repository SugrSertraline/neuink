/** Provider-independent, sequential agent loop. Business writes remain in tools. */
export class AgentStoppedError extends Error {}

export class RunBudget {
  turns = 0;
  toolCalls = 0;
  inputTokens = 0;
  outputTokens = 0;
  persist?: () => Promise<void>;
  constructor(readonly maxTurns = 24, readonly maxToolCalls = 48, readonly maxDepth = 2, readonly maxReportedTokens = 512_000) {}
  turn() {
    if (this.inputTokens + this.outputTokens >= this.maxReportedTokens) throw new AgentStoppedError('Request token budget exhausted.');
    if (this.turns >= this.maxTurns) throw new AgentStoppedError('Agent tree model-turn budget exhausted.');
    this.turns++;
  }
  tool() {
    if (this.toolCalls >= this.maxToolCalls) throw new AgentStoppedError('Agent tree tool-call budget exhausted.');
    this.toolCalls++;
  }
  usage(input = 0, output = 0) {
    this.inputTokens += Number.isFinite(input) ? Math.max(0, Math.floor(input)) : 0;
    this.outputTokens += Number.isFinite(output) ? Math.max(0, Math.floor(output)) : 0;
  }
  snapshot() {
    return { turns: this.turns, toolCalls: this.toolCalls, inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }
  restore(value: ReturnType<RunBudget['snapshot']>) {
    for (const key of ['turns', 'toolCalls', 'inputTokens', 'outputTokens'] as const) {
      if (!value || !Number.isSafeInteger(value[key]) || value[key] < 0) throw new AgentStoppedError('任务检查点中的预算记录无效，已停止恢复。');
    }
    Object.assign(this, value && { turns: value.turns, toolCalls: value.toolCalls,
      inputTokens: value.inputTokens, outputTokens: value.outputTokens });
  }
}

export type AgentToolCall = { id: string; name: string; input: unknown; error?: string };
export type AgentTurn<M> = { text: string; messages: M[]; calls: AgentToolCall[] };
export type AgentDriver<M> = {
  turn(messages: readonly M[], signal?: AbortSignal): Promise<AgentTurn<M>>;
  result(call: AgentToolCall, output: unknown, failed: boolean): M;
  instruction(text: string): M;
};
export type AgentToolContext = { id: string; signal?: AbortSignal };
export type AgentTool = ((input: unknown, context: AgentToolContext) => Promise<unknown>) & {
  /** Validate/confirm without effects, before recording an irreversible attempt. Never persist consent. */
  prepare?: (input: unknown, context: AgentToolContext) => Promise<AgentTool>;
};

/** A write-ahead checkpoint. An in-flight non-replayable tool is never retried automatically. */
export type AgentCheckpoint<M> = {
  messages: M[];
  turns: number;
  pending?: { response: AgentTurn<M>; next: number; started: boolean };
  answer?: string;
};
export type AgentEvent =
  | { type: 'agent_start' | 'turn_start' | 'turn_end' | 'agent_end' }
  | { type: 'tool_start' | 'tool_end'; call: AgentToolCall; failed?: boolean };
export class AgentPersistenceError extends AgentStoppedError {}

/** Also interrupts waits on transports that do not implement cancellation themselves. */
export async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    void operation.catch(() => undefined);
    signal.throwIfAborted();
  }
  if (!signal) return operation;
  let listener: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        listener = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        signal.addEventListener('abort', listener, { once: true });
      })
    ]);
  } finally {
    if (listener) signal.removeEventListener('abort', listener);
  }
}

export class Agent<M> {
  readonly messages: M[];
  private turns = 0;
  private pending?: AgentCheckpoint<M>['pending'];
  private answer?: string;
  private readonly steering: M[] = [];
  private readonly followUps: M[] = [];
  private settling = false;
  private readonly idleWaiters = new Set<() => void>();
  private readonly listeners = new Set<(event: AgentEvent) => void | Promise<void>>();
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' = 'idle';
  constructor(private readonly options: {
    driver: AgentDriver<M>;
    tools: Record<string, AgentTool>;
    messages: M[];
    budget: RunBudget;
    signal?: AbortSignal;
    maxTurns?: number;
    beforeTurn?: () => void;
    /** Return an instruction to continue the SAME transcript under the SAME budget. */
    verify?: (text: string) => string | undefined;
    onToolError?: (call: AgentToolCall, error: unknown) => void;
    isFatal?: (error: unknown) => boolean;
    checkpoint?: AgentCheckpoint<M>;
    saveCheckpoint?: (checkpoint: AgentCheckpoint<M>) => Promise<void>;
    canReplayTool?: (name: string) => boolean;
  }) {
    const saved = options.checkpoint;
    if (saved) validateCheckpoint(saved);
    this.messages = [...(saved?.messages ?? options.messages)];
    this.turns = saved?.turns ?? 0;
    this.pending = saved?.pending;
    this.answer = saved?.answer;
  }

  steer(message: M) { this.steering.push(message); }
  followUp(message: M) { this.followUps.push(message); }
  waitForIdle(): Promise<void> {
    return this.settling ? new Promise(resolve => { this.idleWaiters.add(resolve); }) : Promise.resolve();
  }
  subscribe(listener: (event: AgentEvent) => void | Promise<void>) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private async emit(event: AgentEvent) {
    for (const listener of this.listeners) await listener(event);
  }
  private async save() {
    if (!this.options.saveCheckpoint) return;
    try {
      await this.options.saveCheckpoint({ messages: this.messages, turns: this.turns, pending: this.pending, answer: this.answer });
    } catch (error) {
      if (error instanceof AgentPersistenceError) throw error;
      throw new AgentPersistenceError('任务检查点保存失败，已停止执行。请检查存储后继续，系统不会自动重放结果不明的操作。');
    }
  }

  async run(): Promise<string> {
    if (this.status !== 'idle') throw new AgentStoppedError('An Agent instance runs once.');
    this.status = 'running';
    this.settling = true;
    const o = this.options;
    try {
      await this.emit({ type: 'agent_start' });
      if (this.answer !== undefined) {
        this.status = 'completed';
        return this.answer;
      }
      while (this.pending || this.turns < (o.maxTurns ?? 12)) {
        o.signal?.throwIfAborted();
        if (!this.pending) {
          this.messages.push(...this.steering.splice(0));
          o.budget.turn();
          this.turns++;
          o.beforeTurn?.();
          await this.save(); // Reserve the attempt before network I/O, including interrupted requests.
          await this.emit({ type: 'turn_start' });
          const response = await abortable(o.driver.turn(this.messages, o.signal), o.signal);
          o.signal?.throwIfAborted();
          this.messages.push(...response.messages);
          this.pending = { response, next: 0, started: false };
          await this.save(); // Never execute a model's tool batch until it is durable.
        }
        const { response } = this.pending;
        while (this.pending.next < response.calls.length) {
          const call = response.calls[this.pending.next];
          o.signal?.throwIfAborted();
          if (this.pending.started && !o.canReplayTool?.(call.name)) {
            throw new AgentStoppedError(`工具 ${call.name} 的执行结果尚未确认。为避免重复操作，已停止自动恢复；请先核对目标数据或外部服务。`);
          }
          if (!this.pending.started) o.budget.tool();
          let output: unknown;
          let failed = false;
          let invoked = false;
          try {
            if (call.error) throw new Error(call.error);
            let execute = o.tools[call.name];
            if (!execute) throw new Error(`Tool is not available: ${call.name}`);
            if (execute.prepare) execute = await abortable(execute.prepare(call.input, { id: call.id, signal: o.signal }), o.signal);
            o.signal?.throwIfAborted();
            this.pending.started = true;
            await this.save();
            await this.emit({ type: 'tool_start', call });
            invoked = true;
            output = await abortable(execute(call.input, { id: call.id, signal: o.signal }), o.signal);
          } catch (error) {
            if (o.signal?.aborted || error instanceof AgentStoppedError || o.isFatal?.(error)) throw error;
            if (invoked && o.saveCheckpoint && !o.canReplayTool?.(call.name)) {
              throw new AgentStoppedError(`工具 ${call.name} 返回错误，但无法确认是否已产生修改。已停止自动重试，请先核对目标数据或外部服务。`);
            }
            failed = true;
            output = { error: error instanceof Error ? error.message : String(error) };
            o.onToolError?.(call, error);
          }
          o.signal?.throwIfAborted();
          this.messages.push(o.driver.result(call, output, failed));
          this.pending.next++;
          this.pending.started = false;
          await this.save();
          await this.emit({ type: 'tool_end', call, failed });
        }
        await this.emit({ type: 'turn_end' });
        if (response.calls.length || this.steering.length) {
          this.pending = undefined;
          await this.save();
          continue;
        }
        if (this.followUps.length) {
          this.messages.push(...this.followUps.splice(0));
          this.pending = undefined;
          await this.save();
          continue;
        }
        const correction = o.verify?.(response.text);
        if (correction) {
          this.messages.push(o.driver.instruction(correction));
          this.pending = undefined;
          await this.save();
          continue;
        }
        this.answer = response.text;
        this.pending = undefined;
        await this.save();
        this.status = 'completed';
        return response.text;
      }
      throw new AgentStoppedError('Agent model-turn limit exhausted.');
    } catch (error) {
      this.status = o.signal?.aborted ? 'cancelled' : 'failed';
      throw error;
    } finally {
      try { await this.emit({ type: 'agent_end' }); }
      finally {
        this.settling = false;
        for (const resolve of this.idleWaiters) resolve();
        this.idleWaiters.clear();
      }
    }
  }
}

function validateCheckpoint<M>(saved: AgentCheckpoint<M>) {
  const pending = saved.pending;
  if (!Array.isArray(saved.messages) || !Number.isSafeInteger(saved.turns) || saved.turns < 0
    || (saved.answer !== undefined && typeof saved.answer !== 'string')
    || (pending !== undefined && (!pending || saved.answer !== undefined
      || !Number.isSafeInteger(pending.next) || pending.next < 0 || typeof pending.started !== 'boolean'
      || !pending.response || typeof pending.response.text !== 'string'
      || !Array.isArray(pending.response.messages) || !Array.isArray(pending.response.calls)
      || pending.next > pending.response.calls.length
      || (pending.started && pending.next === pending.response.calls.length)
      || pending.response.calls.some(call => !call || typeof call.id !== 'string' || !call.id
        || typeof call.name !== 'string' || !call.name)))) {
    throw new AgentStoppedError('任务检查点中的执行状态无效，已停止恢复，未执行模型或工具。');
  }
}
