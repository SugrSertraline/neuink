import { createAgentToolFailure, isAgentToolFailure, type AgentToolFailure, type AgentToolNotExecutedCode } from './toolFailure';

/** Provider-independent, sequential agent loop. Business writes remain in tools. */
export class AgentStoppedError extends Error {}
/** Recoverable only at a delegated-agent boundary; the current agent still stops. */
export class AgentLocalLimitError extends AgentStoppedError {
  constructor(readonly reason: 'output_length' | 'context_capacity' | 'turn_limit', message: string) { super(message); }
}
/** Only host guards BEFORE an effect may use this error; never infer it from remote text. */
export class AgentToolNotExecutedError extends Error {
  constructor(message?: string, readonly code: AgentToolNotExecutedCode = 'TOOL_NOT_EXECUTED') { super(message); }
}

export class RunBudget {
  turns = 0;
  toolCalls = 0;
  inputTokens = 0;
  outputTokens = 0;
  private uncertainWriteGate = false;
  get writesBlocked() { return this.uncertainWriteGate; }
  /** Monotonic for the entire agent tree, including restored actors and new call IDs. */
  blockUncertainWrites() { this.uncertainWriteGate = true; }
  persist?: () => Promise<void>;
  constructor(readonly maxTurns = 24, readonly maxToolCalls = 48, readonly maxDepth = 2, readonly maxReportedTokens = 512_000) {}
  assertCanTurn() {
    if (this.inputTokens + this.outputTokens >= this.maxReportedTokens) throw new AgentStoppedError('Request token budget exhausted.');
    if (this.turns >= this.maxTurns) throw new AgentStoppedError('Agent tree model-turn budget exhausted.');
  }
  turn() {
    this.assertCanTurn();
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
    return { turns: this.turns, toolCalls: this.toolCalls, inputTokens: this.inputTokens, outputTokens: this.outputTokens,
      ...(this.writesBlocked ? { uncertainWriteGate: true as const } : {}) };
  }
  restore(value: ReturnType<RunBudget['snapshot']>) {
    for (const key of ['turns', 'toolCalls', 'inputTokens', 'outputTokens'] as const) {
      if (!value || !Number.isSafeInteger(value[key]) || value[key] < 0) throw new AgentStoppedError('任务检查点中的预算记录无效，已停止恢复。');
    }
    if (value.uncertainWriteGate !== undefined && value.uncertainWriteGate !== true) throw new AgentStoppedError('任务检查点中的预算记录无效，已停止恢复。');
    Object.assign(this, value && { turns: value.turns, toolCalls: value.toolCalls,
      inputTokens: value.inputTokens, outputTokens: value.outputTokens });
    if (value.uncertainWriteGate) this.blockUncertainWrites();
  }
}

export type AgentToolCall = {
  id: string; name: string; input: unknown; error?: string;
  /** Host driver classification, never copied from provider exception text. */
  errorCode?: 'TOOL_NOT_AVAILABLE' | 'TOOL_INVALID_ARGUMENTS';
};
export type AgentTurn<M> = { text: string; messages: M[]; calls: AgentToolCall[] };
export type AgentDriver<M> = {
  turn(messages: readonly M[], signal?: AbortSignal, options?: { finalTurn: boolean }): Promise<AgentTurn<M>>;
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
  uncertainWriteGate?: true;
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
    /** A delegated reader must leave its parent one model turn, including compaction. */
    reserveParentTurn?: boolean;
    beforeTurn?: () => void;
    /** Return an instruction to continue the SAME transcript under the SAME budget. */
    verify?: (text: string) => string | undefined;
    onToolError?: (call: AgentToolCall, error: unknown, failure: AgentToolFailure) => void;
    /** Host-owned allowlist only: never return raw exceptions, paths, payloads, or credentials. */
    toolErrorDiagnostic?: (error: unknown) => string | undefined;
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
    if (saved?.uncertainWriteGate || (this.pending?.started
      && !options.canReplayTool?.(this.pending.response.calls[this.pending.next].name))) options.budget.blockUncertainWrites();
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
      await this.options.saveCheckpoint({ messages: this.messages, turns: this.turns, pending: this.pending, answer: this.answer,
        ...(this.options.budget.writesBlocked ? { uncertainWriteGate: true as const } : {}) });
    } catch (error) {
      if (error instanceof AgentPersistenceError) throw error;
      throw new AgentPersistenceError('任务检查点保存失败，已停止执行。请检查存储后继续，系统不会自动重放结果不明的操作。');
    }
  }

  private async blockUncertainWrites() {
    this.options.budget.blockUncertainWrites();
    await this.save(); // Keep the started attempt durable until its unknown result is recorded.
    try { await this.options.budget.persist?.(); }
    catch (error) {
      if (error instanceof AgentPersistenceError) throw error;
      throw new AgentPersistenceError('任务写入保护保存失败，已停止执行。请检查存储后继续。');
    }
  }

  private async executeTool(call: AgentToolCall): Promise<{ output: unknown; failed: boolean }> {
    const o = this.options;
    const replayable = o.canReplayTool?.(call.name) === true;
    let invoked = false;
    let failureCode: AgentToolNotExecutedCode = 'TOOL_NOT_EXECUTED';
    const assertWriteAllowed = () => {
      if (!replayable && o.budget.writesBlocked) throw new AgentToolNotExecutedError(undefined, 'TOOL_WRITE_BLOCKED');
    };
    if (this.pending!.started && !replayable) {
      await this.blockUncertainWrites();
      const failure = createAgentToolFailure('TOOL_OUTCOME_UNKNOWN');
      o.onToolError?.(call, new Error(failure.message), failure);
      return { output: failure, failed: true };
    }
    try {
      if (!this.pending!.started) {
        if (o.budget.toolCalls >= o.budget.maxToolCalls) throw new AgentToolNotExecutedError(undefined, 'TOOL_LIMIT_REACHED');
        o.budget.tool();
      }
      let execute = Object.prototype.hasOwnProperty.call(o.tools, call.name) ? o.tools[call.name] : undefined;
      if (typeof execute !== 'function') throw new AgentToolNotExecutedError(undefined, 'TOOL_NOT_AVAILABLE');
      if (call.error !== undefined || call.errorCode !== undefined) {
        throw new AgentToolNotExecutedError(call.error, call.errorCode ?? 'TOOL_INVALID_ARGUMENTS');
      }
      assertWriteAllowed();
      failureCode = 'TOOL_PREFLIGHT_FAILED';
      if (execute.prepare) execute = await abortable(execute.prepare(call.input, { id: call.id, signal: o.signal }), o.signal);
      o.signal?.throwIfAborted();
      assertWriteAllowed();
      this.pending!.started = true;
      await this.save();
      await this.emit({ type: 'tool_start', call });
      o.signal?.throwIfAborted();
      assertWriteAllowed(); // Another actor may have closed the shared gate while we awaited persistence.
      invoked = true;
      const output = await abortable(execute(call.input, { id: call.id, signal: o.signal }), o.signal);
      if (isAgentToolFailure(output)) {
        if (output.outcome === 'unknown' || output.recovery.writesBlocked) await this.blockUncertainWrites();
        return { output: { ...output, recovery: { ...output.recovery, writesBlocked: o.budget.writesBlocked } }, failed: true };
      }
      return { output, failed: false };
    } catch (error) {
      const unknownWrite = invoked && !replayable && !(error instanceof AgentToolNotExecutedError);
      if (unknownWrite) await this.blockUncertainWrites();
      if (o.signal?.aborted || (error instanceof Error && error.name === 'AbortError')
        || error instanceof AgentStoppedError || o.isFatal?.(error)) throw error;
      const failure = createAgentToolFailure(unknownWrite ? 'TOOL_OUTCOME_UNKNOWN'
        : error instanceof AgentToolNotExecutedError ? error.code : invoked ? 'TOOL_EXECUTION_FAILED' : failureCode,
      o.budget.writesBlocked);
      try {
        const diagnostic = o.toolErrorDiagnostic?.(error);
        if (typeof diagnostic === 'string' && diagnostic.trim()) failure.diagnostic = diagnostic.trim().slice(0, 512);
      } catch (diagnosticError) {
        if (o.signal?.aborted || diagnosticError instanceof AgentStoppedError
          || (diagnosticError instanceof Error && diagnosticError.name === 'AbortError') || o.isFatal?.(diagnosticError)) throw diagnosticError;
      }
      o.onToolError?.(call, error, failure);
      return { output: failure, failed: true };
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
          if (o.reserveParentTurn && o.budget.turns >= o.budget.maxTurns - 1) {
            o.budget.assertCanTurn(); // A depleted shared budget is fatal, never a local reserve.
            throw new AgentLocalLimitError('turn_limit', '子任务模型预算已到，剩余轮次留给主助手总结。');
          }
          o.budget.turn();
          this.turns++;
          o.beforeTurn?.();
          await this.save(); // Reserve the attempt before network I/O, including interrupted requests.
          await this.emit({ type: 'turn_start' });
          const finalTurn = this.turns >= (o.maxTurns ?? 12) || o.budget.turns >= o.budget.maxTurns - (o.reserveParentTurn ? 1 : 0)
            || o.budget.toolCalls >= o.budget.maxToolCalls;
          const response = await abortable(o.driver.turn(this.messages, o.signal, { finalTurn }), o.signal);
          o.signal?.throwIfAborted();
          if (finalTurn && response.calls.length) {
            throw new AgentStoppedError('已到最终总结轮次，但模型仍返回工具调用；未执行这些操作。请缩小任务范围后重试。');
          }
          this.messages.push(...response.messages);
          this.pending = { response, next: 0, started: false };
          await this.save(); // Never execute a model's tool batch until it is durable.
        }
        const { response } = this.pending;
        while (this.pending.next < response.calls.length) {
          const call = response.calls[this.pending.next];
          o.signal?.throwIfAborted();
          const { output, failed } = await this.executeTool(call);
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
      o.budget.assertCanTurn();
      throw new AgentLocalLimitError('turn_limit', 'Agent model-turn limit exhausted.');
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
    || (saved.uncertainWriteGate !== undefined && saved.uncertainWriteGate !== true)
    || (pending !== undefined && (!pending || saved.answer !== undefined
      || !Number.isSafeInteger(pending.next) || pending.next < 0 || typeof pending.started !== 'boolean'
      || !pending.response || typeof pending.response.text !== 'string'
      || !Array.isArray(pending.response.messages) || !Array.isArray(pending.response.calls)
      || pending.next > pending.response.calls.length
      || (pending.started && pending.next === pending.response.calls.length)
      || pending.response.calls.some(call => !call || typeof call.id !== 'string' || !call.id
        || typeof call.name !== 'string' || !call.name
        || (call.error !== undefined && typeof call.error !== 'string')
        || (call.errorCode !== undefined && call.errorCode !== 'TOOL_NOT_AVAILABLE' && call.errorCode !== 'TOOL_INVALID_ARGUMENTS'))))) {
    throw new AgentStoppedError('任务检查点中的执行状态无效，已停止恢复，未执行模型或工具。');
  }
}
