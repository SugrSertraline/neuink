import { abortable, AgentPersistenceError, AgentStoppedError, AgentToolNotExecutedError, RunBudget } from '../agent-core';
import type { AgentTool, AgentToolContext } from '../agent-core/agent';
import { MAX_PARALLEL_TOOLS, ToolScheduler } from '../agent-core/toolScheduler';
import { createAgentToolFailure, isAgentToolFailure } from '../agent-core/toolFailure';
import { canReplayAssistantTool, type DurableExecution } from '../runtime/durableExecution';
import { canParallelAssistantTool, PLANNING_READ_TOOLS } from '../runtime/executionPolicy';

type Journal = {
  pending?: { name: string; replayable: boolean };
  nativePending?: boolean;
  completed: Array<[string, unknown]>;
};

/** CLI owns its transcript; NeuInk owns tool effects and their write-ahead receipts. */
export class LocalAgentCheckpoint {
  private journal: Journal;
  private readonly scheduler = new ToolScheduler(MAX_PARALLEL_TOOLS, error => error instanceof AgentPersistenceError
    || error instanceof AgentStoppedError || (error instanceof Error && error.name === 'AbortError'));
  constructor(private execution: DurableExecution | undefined, readonly budget: RunBudget,
    private capture: () => void,
    private canParallel: (name: string, input: unknown) => boolean = canParallelAssistantTool) {
    this.journal = execution?.get<Journal>('local:journal') ?? { completed: [] };
    if (!this.journal || !Array.isArray(this.journal.completed) || this.journal.completed.some(row =>
      !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string') ||
      (this.journal.nativePending !== undefined && typeof this.journal.nativePending !== 'boolean') ||
      (this.journal.pending !== undefined && (!this.journal.pending || typeof this.journal.pending.name !== 'string' || !this.journal.pending.name))) {
      throw new AgentPersistenceError('本地 Agent 的任务检查点无效，请开始新任务。');
    }
    if (this.journal.nativePending || (this.journal.pending && !canReplayAssistantTool(this.journal.pending.name))) budget.blockUncertainWrites();
    // Interrupted legacy reads may be repeated; only exclusive tools own pending from now on.
    if (this.journal.pending && canParallelAssistantTool(this.journal.pending.name)) delete this.journal.pending;
  }
  async save() {
    this.capture();
    this.execution?.set('local:journal', this.journal);
    await this.execution?.flush();
  }
  async approveNative() {
    this.journal.nativePending = true;
    await this.save();
  }
  async finishNativeTurn() {
    this.journal.nativePending = false;
    await this.save();
  }
  async settled() { await this.scheduler.settled(); }
  run(name: string, input: unknown, context: AgentToolContext, tool: AgentTool, beforeExecute?: () => void): Promise<unknown> {
    const parallel = this.canParallel(name, input) && canReplayAssistantTool(name);
    return this.scheduler.run(parallel, async signal => {
      beforeExecute?.();
      return parallel ? this.read(input, { ...context, signal }, tool) : this.execute(name, input, { ...context, signal }, tool);
    }, context.signal);
  }
  private async read(input: unknown, context: AgentToolContext, tool: AgentTool) {
    context.signal?.throwIfAborted();
    this.budget.tool();
    const prepared = tool.prepare ? await abortable(tool.prepare(input, context), context.signal) : tool;
    context.signal?.throwIfAborted();
    // No pending/receipt for reads: an interrupted request can simply be read again.
    await this.save();
    context.signal?.throwIfAborted();
    const output = await abortable(prepared(input, context), context.signal);
    context.signal?.throwIfAborted();
    if (isAgentToolFailure(output) && output.recovery.writesBlocked) this.budget.blockUncertainWrites();
    await this.save();
    return output;
  }
  private async execute(name: string, input: unknown, context: AgentToolContext, tool: AgentTool) {
    context.signal?.throwIfAborted();
    const replayable = canReplayAssistantTool(name);
    const cacheable = !PLANNING_READ_TOOLS.has(name) && name !== 'ask_user';
    const bytes = new TextEncoder().encode(JSON.stringify([name, canonical(input)]));
    const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    const cached = cacheable && this.journal.completed.find(row => row[0] === key);
    if (cached) return cached[1];
    if (!replayable && this.budget.writesBlocked) return createAgentToolFailure('TOOL_WRITE_BLOCKED');
    this.budget.tool();
    const prepared = tool.prepare ? await tool.prepare(input, context) : tool;
    this.journal.pending = { name, replayable };
    await this.save();
    let output: unknown;
    try {
      output = await prepared(input, context);
    } catch (error) {
      if (error instanceof AgentPersistenceError) throw error;
      if (!replayable && !(error instanceof AgentToolNotExecutedError)) {
        this.budget.blockUncertainWrites();
        output = createAgentToolFailure('TOOL_OUTCOME_UNKNOWN');
      } else {
        delete this.journal.pending;
        await this.save();
        throw error;
      }
    }
    if (isAgentToolFailure(output) && output.recovery.writesBlocked) this.budget.blockUncertainWrites();
    // Persist receipts even when cancellation arrives just after a write completed.
    if (cacheable && (!isAgentToolFailure(output) || !output.recovery.retryable)) this.journal.completed.push([key, output]);
    delete this.journal.pending;
    await this.save();
    context.signal?.throwIfAborted();
    return output;
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
