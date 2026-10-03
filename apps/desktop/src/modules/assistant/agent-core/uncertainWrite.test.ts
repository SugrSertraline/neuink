import { describe, expect, it, vi } from 'vitest';
import { Agent, AgentPersistenceError, AgentStoppedError, RunBudget, type AgentCheckpoint,
  type AgentDriver, type AgentTool, type AgentTurn } from './agent';
import { createAgentToolFailure } from './toolFailure';

const call = (name = 'write', id = name, input = {}) => ({ name, id, input });
const calling = (...calls: ReturnType<typeof call>[]): AgentTurn<string> => ({ text: '', messages: ['calls'], calls });
const final: AgentTurn<string> = { text: 'explained', messages: ['explained'], calls: [] };
function driver(turns: AgentTurn<string>[]): AgentDriver<string> {
  return { turn: vi.fn(async () => { const next = turns.shift(); if (!next) throw new Error('Model unavailable'); return next; }),
    instruction: text => text, result: vi.fn((_, output, failed) => JSON.stringify({ output, failed })) };
}
const replayable = (name: string) => name === 'read' || name === 'delegate';
const unknownWrite = async () => { throw new Error('private service details after commit'); };

describe('uncertain write gate', () => {
  it('blocks the rest of the batch, other write tools and changed IDs/inputs while allowing read-only verification', async () => {
    const write = vi.fn(unknownWrite);
    const other = Object.assign(vi.fn(async () => 'unsafe'), { prepare: vi.fn(async (): Promise<AgentTool> => other) });
    const read = vi.fn(async () => 'already exists');
    const provider = driver([calling(call(), call('other'), call('read')),
      calling(call('write', 'different', { modified: true }), call('mcp_service_update', 'new'), call('read', 'check-again')), final]);
    const budget = new RunBudget();
    const agent = new Agent({ driver: provider, messages: [], budget, canReplayTool: replayable,
      tools: { write, other, read, mcp_service_update: other } });
    expect(await agent.run()).toBe('explained');
    expect(write).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
    expect(other.prepare).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
    expect(provider.result).toHaveBeenNthCalledWith(1, call(), createAgentToolFailure('TOOL_OUTCOME_UNKNOWN'), true);
    for (const index of [1, 3, 4]) expect(vi.mocked(provider.result).mock.calls[index][1]).toEqual(createAgentToolFailure('TOOL_WRITE_BLOCKED'));
    expect(budget.toolCalls).toBe(6);
    expect(budget.snapshot()).toMatchObject({ uncertainWriteGate: true });
    expect(JSON.stringify(agent.messages)).not.toContain('private service');
  });

  it('treats unknown MCP failures conservatively even without durable persistence', async () => {
    const external = vi.fn(unknownWrite);
    const provider = driver([calling(call('mcp_service_read')), calling(call('mcp_other_write')), final]);
    const budget = new RunBudget();
    await new Agent({ driver: provider, messages: [], budget, canReplayTool: replayable,
      tools: { mcp_service_read: external, mcp_other_write: external } }).run();
    expect(external).toHaveBeenCalledOnce();
    expect(budget.writesBlocked).toBe(true);
    expect(vi.mocked(provider.result).mock.calls[0][1]).toMatchObject({ outcome: 'unknown' });
  });

  it('also closes the gate for an explicitly returned unknown result', async () => {
    const later = vi.fn();
    const provider = driver([calling(call(), call('later')), final]);
    const budget = new RunBudget();
    await new Agent({ driver: provider, messages: [], budget, tools: {
      write: async () => createAgentToolFailure('TOOL_OUTCOME_UNKNOWN'), later
    } }).run();
    expect(later).not.toHaveBeenCalled();
    expect(budget.writesBlocked).toBe(true);
    expect(provider.result).toHaveBeenNthCalledWith(1, call(), createAgentToolFailure('TOOL_OUTCOME_UNKNOWN'), true);
  });

  it('shares the child gate with its parent without turning child recovery into a parent fatal error', async () => {
    const budget = new RunBudget(8);
    const write = vi.fn(unknownWrite);
    const parentWrite = vi.fn();
    const child = new Agent({ driver: driver([calling(call()), final]), messages: [], budget,
      tools: { write }, canReplayTool: replayable, reserveParentTurn: true });
    const provider = driver([calling(call('delegate'), call('parentWrite'), call('read')), final]);
    const read = vi.fn(async () => 'evidence');
    expect(await new Agent({ driver: provider, messages: [], budget, canReplayTool: replayable,
      tools: { delegate: () => child.run(), parentWrite, read } }).run()).toBe('explained');
    expect(child.status).toBe('completed');
    expect(parentWrite).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledOnce();
    expect(budget.turns).toBe(4);
  });

  it.each(['prepare', 'write-ahead'] as const)('checks the shared gate again after awaiting %s', async phase => {
    const budget = new RunBudget();
    const execute = vi.fn(async () => 'must not execute');
    const tool = Object.assign(execute, { prepare: async () => {
      if (phase === 'prepare') budget.blockUncertainWrites();
      return execute;
    } });
    const provider = driver([calling(call()), final]);
    await new Agent({ driver: provider, messages: [], budget, tools: { write: tool },
      saveCheckpoint: async value => { if (phase === 'write-ahead' && value.pending?.started) budget.blockUncertainWrites(); } }).run();
    expect(execute).not.toHaveBeenCalled();
    expect(provider.result).toHaveBeenCalledWith(call(), createAgentToolFailure('TOOL_WRITE_BLOCKED'), true);
  });

  it.each([new AgentStoppedError('Safety stopped'), new AgentPersistenceError('Storage failed'), new DOMException('Cancelled', 'AbortError')])(
    'keeps fatal errors fatal while protecting other actors from an already-started uncertain write: %j', async error => {
      const budget = new RunBudget();
      const provider = driver([calling(call()), final]);
      await expect(new Agent({ driver: provider, messages: [], budget,
        tools: { write: async () => { throw error; } } }).run()).rejects.toBe(error);
      expect(budget.writesBlocked).toBe(true);
      expect(provider.result).not.toHaveBeenCalled();
    });

  it('protects the shared tree even if a cancelled transport continues running after cancellation', async () => {
    const controller = new AbortController();
    const budget = new RunBudget();
    let saved!: AgentCheckpoint<string>;
    const provider = driver([calling(call())]);
    await expect(new Agent({ driver: provider, messages: [], budget, signal: controller.signal,
      tools: { write: async () => { controller.abort(new Error('User stopped')); return new Promise(() => {}); } },
      saveCheckpoint: async value => { saved = structuredClone(value); } }).run()).rejects.toThrow('User stopped');
    expect(saved).toMatchObject({ uncertainWriteGate: true, pending: { started: true, next: 0 } });
    expect(budget.writesBlocked).toBe(true);
  });
});

describe('durable uncertain write recovery', () => {
  it.each([false, null, 1, 'true'])('rejects malformed gate snapshots atomically: %j', gate => {
    const budget = new RunBudget();
    const before = budget.snapshot();
    expect(() => budget.restore({ ...before, turns: 10, uncertainWriteGate: gate } as never)).toThrow('预算记录无效');
    expect(budget.snapshot()).toEqual(before);
    expect(() => new Agent({ driver: driver([]), messages: [], tools: {}, budget,
      checkpoint: { messages: [], turns: 0, uncertainWriteGate: gate } as never })).toThrow('执行状态无效');
  });

  it('accepts old snapshots, persists the gate, and never unlocks it through an older restore', () => {
    const budget = new RunBudget();
    const old = { turns: 1, toolCalls: 1, inputTokens: 2, outputTokens: 3 };
    budget.restore(old);
    expect(budget.snapshot()).toEqual(old);
    budget.restore({ ...old, uncertainWriteGate: true });
    budget.restore(old);
    expect(budget.snapshot()).toEqual({ ...old, uncertainWriteGate: true });
  });

  it('returns an interrupted write as unknown, never repeats it, and continues reads without double charging', async () => {
    const write = vi.fn(); const read = vi.fn(async () => 'found');
    const checkpoint: AgentCheckpoint<string> = { messages: ['calls'], turns: 1,
      pending: { response: calling(call(), call('read'), call('write', 'other')), next: 0, started: true } };
    const budget = new RunBudget(); budget.restore({ turns: 1, toolCalls: 1, inputTokens: 0, outputTokens: 0 });
    const persist = vi.fn(async () => {}); budget.persist = persist;
    const saves: AgentCheckpoint<string>[] = [];
    const provider = driver([final]);
    const agent = new Agent({ driver: provider, messages: [], checkpoint, budget, tools: { write, read }, canReplayTool: replayable,
      saveCheckpoint: async value => { saves.push(structuredClone(value)); } });
    expect(budget.writesBlocked).toBe(true);
    expect(await agent.run()).toBe('explained');
    expect(write).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce();
    expect(budget.toolCalls).toBe(3); expect(budget.turns).toBe(2);
    expect(persist).toHaveBeenCalled();
    expect(saves[0]).toMatchObject({ uncertainWriteGate: true, pending: { started: true, next: 0 } });
    expect(saves[saves.length - 1]).toMatchObject({ uncertainWriteGate: true, answer: 'explained' });
    expect(provider.result).toHaveBeenNthCalledWith(1, call(), createAgentToolFailure('TOOL_OUTCOME_UNKNOWN'), true);
  });

  it('keeps the gate after interrupted result persistence and after restoring into a fresh parent budget', async () => {
    let durable!: AgentCheckpoint<string>;
    const write = vi.fn(unknownWrite);
    const budget = new RunBudget();
    await expect(new Agent({ driver: driver([calling(call())]), messages: [], budget, tools: { write },
      saveCheckpoint: async value => {
        if (value.pending?.next === 1) throw new Error('disk full after the gate checkpoint');
        durable = structuredClone(value);
      } }).run()).rejects.toBeInstanceOf(AgentPersistenceError);
    expect(durable).toMatchObject({ uncertainWriteGate: true, pending: { started: true, next: 0 } });
    const restored = new RunBudget();
    const provider = driver([calling(call('write', 'new-id', { different: true }), call('read')), final]);
    const read = vi.fn(async () => 'verified');
    await new Agent({ driver: provider, messages: [], checkpoint: durable, budget: restored,
      tools: { write, read }, canReplayTool: replayable }).run();
    expect(write).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    expect(restored.writesBlocked).toBe(true);
  });

  it('restores the gate even after the pending unknown call has been consumed', async () => {
    let saved!: AgentCheckpoint<string>;
    const write = vi.fn(unknownWrite);
    await expect(new Agent({ driver: driver([calling(call())]), messages: [], budget: new RunBudget(), tools: { write },
      saveCheckpoint: async value => { saved = structuredClone(value); } }).run()).rejects.toThrow('Model unavailable');
    expect(saved.pending).toBeUndefined();
    expect(saved.uncertainWriteGate).toBe(true);
    const provider = driver([calling(call('write', 'new-id')), final]);
    await new Agent({ driver: provider, messages: [], budget: new RunBudget(), tools: { write }, checkpoint: saved }).run();
    expect(write).toHaveBeenCalledOnce();
    expect(provider.result).toHaveBeenCalledWith(call('write', 'new-id'), createAgentToolFailure('TOOL_WRITE_BLOCKED'), true);
  });

  it('does not continue the model when saving the shared gate fails', async () => {
    const budget = new RunBudget(); budget.persist = async () => { throw new Error('private disk error'); };
    const provider = driver([calling(call()), final]);
    await expect(new Agent({ driver: provider, messages: [], budget, tools: { write: unknownWrite } }).run()).rejects.toBeInstanceOf(AgentPersistenceError);
    expect(provider.result).not.toHaveBeenCalled();
    expect(provider.turn).toHaveBeenCalledOnce();
    expect(budget.writesBlocked).toBe(true);
  });
});
