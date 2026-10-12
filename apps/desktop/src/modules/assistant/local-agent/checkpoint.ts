import { AgentPersistenceError, AgentToolNotExecutedError, RunBudget } from '../agent-core';
import type { AgentTool, AgentToolContext } from '../agent-core/agent';
import { createAgentToolFailure, isAgentToolFailure } from '../agent-core/toolFailure';
import { canReplayAssistantTool, type DurableExecution } from '../runtime/durableExecution';
import { PLANNING_READ_TOOLS } from '../runtime/executionPolicy';

type Journal = {
  pending?: { name: string; replayable: boolean };
  nativePending?: boolean;
  completed: Array<[string, unknown]>;
};

/** CLI owns its transcript; NeuInk owns tool effects and their write-ahead receipts. */
export class LocalAgentCheckpoint {
  private journal: Journal;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private execution: DurableExecution | undefined, readonly budget: RunBudget,
    private capture: () => void) {
    this.journal = execution?.get<Journal>('local:journal') ?? { completed: [] };
    if (!this.journal || !Array.isArray(this.journal.completed) || this.journal.completed.some(row =>
      !Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string') ||
      (this.journal.nativePending !== undefined && typeof this.journal.nativePending !== 'boolean') ||
      (this.journal.pending !== undefined && (!this.journal.pending || typeof this.journal.pending.name !== 'string' || !this.journal.pending.name))) {
      throw new AgentPersistenceError('本地 Agent 的任务检查点无效，请开始新任务。');
    }
    if (this.journal.nativePending || (this.journal.pending && !canReplayAssistantTool(this.journal.pending.name))) budget.blockUncertainWrites();
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
  async settled() { await this.queue; }
  run(name: string, input: unknown, context: AgentToolContext, tool: AgentTool): Promise<unknown> {
    const result = this.queue.then(() => this.execute(name, input, context, tool));
    // Ordinary tool failures are observations. A failed checkpoint stops every later call.
    this.queue = result.catch(error => { if (error instanceof AgentPersistenceError) throw error; });
    void this.queue.catch(() => undefined);
    return result;
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
