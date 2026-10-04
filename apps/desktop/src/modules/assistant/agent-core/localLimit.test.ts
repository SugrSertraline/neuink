import { describe, expect, it, vi } from 'vitest';
import { Agent, AgentLocalLimitError, AgentLoopGuard, AgentPersistenceError, AgentStoppedError, RunBudget,
  createAgentLoopState, type AgentDriver, type AgentTurn } from './index';

const call = { id: 'read-1', name: 'read', input: {} };
const final: AgentTurn<string> = { text: 'answer', messages: ['answer'], calls: [] };
const calling: AgentTurn<string> = { text: '', messages: ['calls'], calls: [call] };
function driver(turns: AgentTurn<string>[]): AgentDriver<string> {
  return { turn: vi.fn(async () => { const turn = turns.shift(); if (!turn) throw new Error('Unexpected request'); return turn; }),
    result: vi.fn((_, output) => JSON.stringify(output)), instruction: text => text };
}
async function rejection(operation: Promise<unknown>) {
  try { await operation; } catch (error) { return error; }
  throw new Error('Expected an execution to stop');
}

describe('typed local agent limits', () => {
  it.each(['output_length', 'context_capacity', 'turn_limit'] as const)('exposes only an explicit %s subtype of stopped', reason => {
    const error = new AgentLocalLimitError(reason, 'Local limit');
    expect(error).toBeInstanceOf(AgentStoppedError);
    expect(error.reason).toBe(reason);
    expect(new AgentStoppedError('Unknown stop')).not.toBeInstanceOf(AgentLocalLimitError);
    expect(new AgentPersistenceError('Storage failure')).not.toBeInstanceOf(AgentLocalLimitError);
  });

  it('stops the current agent at its local turn limit without resetting or consuming the parent reserve', async () => {
    const budget = new RunBudget(4);
    const provider = driver([final]);
    const agent = new Agent({ driver: provider, tools: {}, messages: [], budget, maxTurns: 1, verify: () => 'Try again' });
    const error = await rejection(agent.run());
    expect(error).toBeInstanceOf(AgentLocalLimitError);
    expect(error).toMatchObject({ reason: 'turn_limit' });
    expect(agent.status).toBe('failed');
    expect(provider.turn).toHaveBeenCalledOnce();
    expect(budget.turns).toBe(1);
    expect(await new Agent({ driver: driver([final]), tools: {}, messages: [], budget }).run()).toBe('answer');
  });

  it('identifies the parent-reserved model turn as local, leaving it unused', async () => {
    const budget = new RunBudget(4); budget.turns = 3;
    const provider = driver([final]);
    const error = await rejection(new Agent({ driver: provider, tools: {}, messages: [], budget, reserveParentTurn: true }).run());
    expect(error).toBeInstanceOf(AgentLocalLimitError);
    expect(provider.turn).not.toHaveBeenCalled();
    expect(budget.turns).toBe(3);
    expect(await new Agent({ driver: driver([final]), tools: {}, messages: [], budget }).run()).toBe('answer');
  });

  it('keeps violations of the final-turn no-tools contract fatal even at a local cap', async () => {
    const execute = vi.fn();
    const error = await rejection(new Agent({ driver: driver([calling]), tools: { read: execute }, messages: [],
      budget: new RunBudget(), maxTurns: 1 }).run());
    expect(error).toBeInstanceOf(AgentStoppedError);
    expect(error).not.toBeInstanceOf(AgentLocalLimitError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('classifies the explicit cycle-guard turn cap as local and retains its failed state', () => {
    const state = createAgentLoopState('read'); state.turnCount = state.maxTurns;
    const guard = new AgentLoopGuard(state);
    expect(() => guard.startTurn()).toThrow(AgentLocalLimitError);
    expect(state.status).toBe('failed');
    expect(state.stopReason).toContain('turns');
  });

  it.each(['turns', 'tokens'] as const)('never relabels already exhausted shared %s as a parent-reserve limit', async exhausted => {
    const budget = new RunBudget(4, 48, 2, 10); budget.turns = exhausted === 'turns' ? 4 : 3;
    if (exhausted === 'tokens') budget.usage(10);
    const provider = driver([final]);
    const error = await rejection(new Agent({ driver: provider, tools: {}, messages: [], budget, reserveParentTurn: true }).run());
    expect(error).toBeInstanceOf(AgentStoppedError);
    expect(error).not.toBeInstanceOf(AgentLocalLimitError);
    expect(provider.turn).not.toHaveBeenCalled();
  });

  it('keeps global model exhaustion fatal even when the local turn cap is reached simultaneously', async () => {
    const provider = driver([final]);
    const budget = new RunBudget(1);
    const error = await rejection(new Agent({ driver: provider, tools: {}, messages: [], budget, maxTurns: 1, verify: () => 'Again' }).run());
    expect(error).toBeInstanceOf(AgentStoppedError);
    expect(error).not.toBeInstanceOf(AgentLocalLimitError);
    expect(provider.turn).toHaveBeenCalledOnce();
  });

  it.each(['turns', 'tools', 'tokens'] as const)('does not soften a final-turn tool violation when shared %s are exhausted', async exhausted => {
    const budget = new RunBudget(exhausted === 'turns' ? 1 : 5, 1, 2, 10);
    if (exhausted === 'tools') budget.toolCalls = 1;
    const provider = driver([calling]);
    if (exhausted === 'tokens') vi.mocked(provider.turn).mockImplementationOnce(async () => { budget.usage(10); return calling; });
    const execute = vi.fn();
    const error = await rejection(new Agent({ driver: provider, tools: { read: execute }, messages: [], budget, maxTurns: 1 }).run());
    expect(error).toBeInstanceOf(AgentStoppedError);
    expect(error).not.toBeInstanceOf(AgentLocalLimitError);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([new AgentLocalLimitError('context_capacity', 'Local capacity'), new AgentStoppedError('Unknown stop'),
    new AgentPersistenceError('Storage failure')])('does not automatically swallow stopped errors inside the current agent: %j', async error => {
      const provider = driver([calling, final]);
      const result = await rejection(new Agent({ driver: provider, tools: { read: async () => { throw error; } }, messages: [],
        budget: new RunBudget(), canReplayTool: () => true }).run());
      expect(result).toBe(error);
      expect(provider.result).not.toHaveBeenCalled();
      expect(provider.turn).toHaveBeenCalledOnce();
    });
});
