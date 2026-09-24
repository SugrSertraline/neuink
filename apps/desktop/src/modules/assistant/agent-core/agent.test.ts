import { describe, expect, it, vi } from 'vitest';
import { Agent, AgentStoppedError, RunBudget, type AgentDriver, type AgentTurn } from './agent';

function fixture(turns: AgentTurn<string>[]) {
  const driver: AgentDriver<string> = {
    turn: vi.fn(async () => { const next = turns.shift(); if (!next) throw new Error('Unexpected turn'); return next; }),
    result: (call, output, failed) => JSON.stringify({ id: call.id, output, failed }),
    instruction: (text) => text
  };
  return driver;
}
const call = (name = 'read', id = 'c1') => ({ id, name, input: { key: 1 } });
const final = (text = 'answer'): AgentTurn<string> => ({ text, messages: [text], calls: [] });
const calling = (...calls: ReturnType<typeof call>[]): AgentTurn<string> => ({ text: '', messages: ['tool-call'], calls });

describe('Agent kernel', () => {
  it('continues with the full ordered transcript after tool execution', async () => {
    const driver = fixture([calling(call(), call('read', 'c2')), final()]);
    const execute = vi.fn(async () => 'evidence');
    const agent = new Agent({ driver, tools: { read: execute }, messages: ['question'], budget: new RunBudget() });
    expect(await agent.run()).toBe('answer');
    expect(agent.messages).toHaveLength(5);
    expect(JSON.parse(agent.messages[2])).toMatchObject({ id: 'c1', output: 'evidence' });
    expect(JSON.parse(agent.messages[3])).toMatchObject({ id: 'c2' });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(agent.status).toBe('completed');
    await expect(agent.run()).rejects.toThrow('runs once');
  });
  it('returns ordinary tool errors to the model for recovery', async () => {
    const driver = fixture([calling(call('missing')), final('blocked')]);
    const agent = new Agent({ driver, tools: {}, messages: [], budget: new RunBudget() });
    expect(await agent.run()).toBe('blocked');
    expect(JSON.parse(agent.messages[1])).toMatchObject({ failed: true });
  });
  it('does not execute invalid tool arguments', async () => {
    const execute = vi.fn();
    const driver = fixture([calling({ ...call(), error: 'bad schema' } as never), final()]);
    await new Agent({ driver, tools: { read: execute }, messages: [], budget: new RunBudget() }).run();
    expect(execute).not.toHaveBeenCalled();
  });
  it('shares hard budgets across parent and child instances', async () => {
    const budget = new RunBudget(2, 1);
    const child = new Agent({ driver: fixture([final('child')]), tools: {}, messages: [], budget });
    const parent = new Agent({ driver: fixture([calling(call('child')), final()]), tools: { child: () => child.run() }, messages: [], budget });
    await expect(parent.run()).rejects.toThrow('budget exhausted');
    expect(budget.turns).toBe(2);
    expect(budget.toolCalls).toBe(1);
  });
  it('keeps corrections in the transcript and never resets budgets', async () => {
    const budget = new RunBudget(2);
    const agent = new Agent({ driver: fixture([final('draft'), final('fixed')]), tools: {}, messages: ['question'], budget,
      verify: (text) => text === 'draft' ? 'Add citations' : undefined });
    expect(await agent.run()).toBe('fixed');
    expect(agent.messages).toEqual(['question', 'draft', 'Add citations', 'fixed']);
    expect(budget.turns).toBe(2);
  });
  it('terminates at the per-agent limit', async () => {
    const agent = new Agent({ driver: fixture([final()]), tools: {}, messages: [], budget: new RunBudget(), maxTurns: 1, verify: () => 'retry' });
    await expect(agent.run()).rejects.toThrow(AgentStoppedError);
    expect(agent.status).toBe('failed');
  });
  it('aborts an uncooperative tool and never executes later calls', async () => {
    const controller = new AbortController();
    const later = vi.fn();
    const agent = new Agent({ driver: fixture([calling(call(), call('later'))]), tools: {
      read: async () => { controller.abort(); return new Promise(() => {}); }, later
    }, messages: [], budget: new RunBudget(), signal: controller.signal });
    await expect(agent.run()).rejects.toBeDefined();
    expect(agent.status).toBe('cancelled');
    expect(later).not.toHaveBeenCalled();
  });
  it('does not swallow provider failures or retry in a different mode', async () => {
    const driver = fixture([]);
    const agent = new Agent({ driver, tools: {}, messages: [], budget: new RunBudget() });
    await expect(agent.run()).rejects.toThrow('Unexpected turn');
    expect(driver.turn).toHaveBeenCalledOnce();
  });
});
