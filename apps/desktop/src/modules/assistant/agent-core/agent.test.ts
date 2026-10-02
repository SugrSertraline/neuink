import { describe, expect, it, vi } from 'vitest';
import { Agent, AgentStoppedError, AgentToolNotExecutedError, RunBudget, type AgentDriver, type AgentTurn } from './agent';

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
  it('protects a parent response even when child context compaction consumes an extra turn', async () => {
    const budget = new RunBudget(4); budget.turns = 1;
    const driver = fixture([calling(call())]);
    vi.mocked(driver.turn).mockImplementationOnce(async () => { budget.turn(); return calling(call()); });
    const child = new Agent({ driver, tools: { read: async () => 'partial' }, messages: [], budget, reserveParentTurn: true });
    await expect(child.run()).rejects.toThrow('留给主助手');
    expect(budget.turns).toBe(3);
    expect(await new Agent({ driver: fixture([final('Parent summary')]), tools: {}, messages: [], budget }).run()).toBe('Parent summary');
  });
  it('reports a host pre-effect rejection without treating it as an uncertain write', async () => {
    const driver = fixture([calling(call('write')), final('Not performed')]);
    const execute = vi.fn(async () => { throw new AgentToolNotExecutedError('Duplicate call; not executed'); });
    const agent = new Agent({ driver, tools: { write: execute }, messages: [], budget: new RunBudget(), saveCheckpoint: async () => {} });
    expect(await agent.run()).toBe('Not performed');
    expect(JSON.parse(agent.messages[1])).toMatchObject({ failed: true });
  });
  it('finishes a batch with explicit errors for calls beyond the tool budget, then summarizes', async () => {
    const driver = fixture([calling(call('read', '1'), call('read', '2'), call('read', '3')), final('Partial')]);
    const execute = vi.fn(async () => 'data');
    const agent = new Agent({ driver, tools: { read: execute }, messages: [], budget: new RunBudget(5, 1) });
    expect(await agent.run()).toBe('Partial');
    expect(execute).toHaveBeenCalledOnce();
    expect(JSON.parse(agent.messages[2])).toMatchObject({ failed: true, output: { error: expect.stringContaining('TOOL_LIMIT_REACHED') } });
    expect(vi.mocked(driver.turn).mock.calls[1][2]).toEqual({ finalTurn: true });
  });
  it('reserves the last individual turn for synthesis and reports it to the driver', async () => {
    const driver = fixture([calling(call()), final('Partial evidence with limitations')]);
    const read = vi.fn(async () => 'evidence');
    const agent = new Agent({ driver, tools: { read }, messages: [], budget: new RunBudget(), maxTurns: 2 });
    expect(await agent.run()).toBe('Partial evidence with limitations');
    expect(vi.mocked(driver.turn).mock.calls.map(args => args[2])).toEqual([{ finalTurn: false }, { finalTurn: true }]);
    expect(read).toHaveBeenCalledOnce();
  });
  it('does not execute calls returned in the final turn, even from a noncompliant driver', async () => {
    const write = vi.fn(async () => 'written');
    const agent = new Agent({ driver: fixture([calling(call('write'))]), tools: { write }, messages: [], budget: new RunBudget(), maxTurns: 1 });
    await expect(agent.run()).rejects.toThrow('未执行这些操作');
    expect(write).not.toHaveBeenCalled();
  });
  it('reserves the final shared-budget turn after restoring a checkpoint', async () => {
    const budget = new RunBudget(3);
    budget.turns = 2;
    const driver = fixture([final('summary')]);
    await new Agent({ driver, tools: {}, messages: [], budget, checkpoint: { messages: ['evidence'], turns: 1 } }).run();
    expect(vi.mocked(driver.turn).mock.calls[0][2]).toEqual({ finalTurn: true });
  });
  it.each(['search_sciverse_evidence', 'search_web'])('returns %s evidence to the agent before publishing its synthesis', async toolName => {
    const driver = fixture([calling(call(toolName)), final('A synthesized answer with sources')]);
    const evidence = { results: [{ title: 'Retrieved evidence', snippet: 'Raw excerpt' }] };
    const execute = vi.fn(async () => evidence);
    const agent = new Agent({ driver, tools: { [toolName]: execute }, messages: ['Find relevant research'], budget: new RunBudget() });
    expect(await agent.run()).toBe('A synthesized answer with sources');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(driver.turn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(agent.messages[2])).toMatchObject({ output: evidence });
  });
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
