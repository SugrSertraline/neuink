import { describe, expect, it, vi } from 'vitest';
import { Agent, AgentPersistenceError, RunBudget, type AgentCheckpoint, type AgentDriver } from './agent';
import { ToolScheduler } from './toolScheduler';

function deferred<T = string>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const call = (id: string, name = 'read') => ({ id, name, input: {} });
function driver(calls = [call('a'), call('b')]): AgentDriver<string> {
  let turn = 0;
  return { turn: vi.fn(async () => ++turn === 1
    ? { text: '', messages: ['calls'], calls }
    : { text: 'answer', messages: ['answer'], calls: [] }),
    result: (item, output, failed) => JSON.stringify({ id: item.id, output, failed }), instruction: text => text };
}
const policies = { canReplayTool: (name: string) => name === 'read', canParallelTool: (name: string) => name === 'read' };

describe('parallel read batches', () => {
  it('overlaps reads, retains original result order and saves only complete batches', async () => {
    const gates = { a: deferred(), b: deferred() };
    const snapshots: AgentCheckpoint<string>[] = [];
    const read = vi.fn((_input, context) => gates[context.id as 'a' | 'b'].promise);
    const agent = new Agent({ driver: driver(), tools: { read }, messages: [], budget: new RunBudget(), ...policies,
      saveCheckpoint: async value => { snapshots.push(structuredClone(value)); } });
    const running = agent.run();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    gates.b.resolve('second');
    await Promise.resolve();
    expect(agent.messages).toEqual(['calls']);
    gates.a.resolve('first');
    expect(await running).toBe('answer');
    expect(agent.messages.slice(1, 3).map(text => JSON.parse(text))).toEqual([
      { id: 'a', output: 'first', failed: false }, { id: 'b', output: 'second', failed: false }
    ]);
    expect(snapshots.some(value => value.pending?.next === 1)).toBe(false);
  });

  it('bounds concurrent reads and does not let later reads overtake an effect', async () => {
    const gate = deferred();
    const calls = [...Array.from({ length: 6 }, (_, index) => call(String(index))), call('w', 'write'), call('last')];
    let active = 0, maximum = 0;
    const finished: string[] = [];
    const read = vi.fn(async (_input, { id }) => {
      active++; maximum = Math.max(maximum, active);
      if (Number(id) < 4) await gate.promise;
      if (id === 'last') expect(finished).toContain('w');
      active--; finished.push(id); return id;
    });
    const write = vi.fn(async () => { expect(active).toBe(0); expect(finished).toHaveLength(6); finished.push('w'); });
    const agent = new Agent({ driver: driver(calls), tools: { read, write }, messages: [], budget: new RunBudget(), ...policies });
    const running = agent.run();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(4));
    expect(write).not.toHaveBeenCalled();
    gate.resolve('go');
    await running;
    expect(maximum).toBe(4);
    expect(finished[finished.length - 1]).toBe('last');
  });

  it('returns a read failure alongside successful evidence and enforces the shared budget', async () => {
    const budget = new RunBudget(5, 2);
    const read = vi.fn(async (_input, { id }) => { if (id === 'a') throw new Error('read failed'); return 'evidence'; });
    const agent = new Agent({ driver: driver([call('a'), call('b'), call('c')]), tools: { read },
      messages: [], budget, ...policies });
    await agent.run();
    const results = agent.messages.slice(1, 4).map(text => JSON.parse(text));
    expect(results[0]).toMatchObject({ failed: true, output: { code: 'TOOL_EXECUTION_FAILED' } });
    expect(results[1]).toMatchObject({ failed: false, output: 'evidence' });
    expect(results[2]).toMatchObject({ failed: true, output: { code: 'TOOL_LIMIT_REACHED' } });
    expect(budget.toolCalls).toBe(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('waits for search prerequisites before overlapping the dependent content reads', async () => {
    let searched = false;
    const gate = deferred();
    const read = vi.fn(async () => { expect(searched).toBe(true); await gate.promise; return 'content'; });
    const agent = new Agent({ driver: driver([call('search', 'search'), call('a'), call('b')]),
      tools: { search: async () => { searched = true; return 'results'; }, read }, messages: [], budget: new RunBudget(),
      canReplayTool: () => true, canParallelTool: name => name === 'search' || searched });
    const running = agent.run();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    gate.resolve('go');
    await running;
  });

  it('stops before reads when the batch budget checkpoint cannot be saved', async () => {
    const read = vi.fn();
    let saves = 0;
    const agent = new Agent({ driver: driver(), tools: { read }, messages: [], budget: new RunBudget(), ...policies,
      saveCheckpoint: async () => { if (++saves === 3) throw new Error('disk'); } });
    await expect(agent.run()).rejects.toBeInstanceOf(AgentPersistenceError);
    expect(read).not.toHaveBeenCalled();
  });

  it('replays an interrupted uncommitted read group, then executes the following write only once', async () => {
    const controller = new AbortController();
    let saved!: AgentCheckpoint<string>;
    const calls = [call('a'), call('b'), call('w', 'write')];
    const write = vi.fn(async () => 'created');
    const read = vi.fn(async (_input, { id }) => {
      if (id === 'b') { controller.abort(); return new Promise<string>(() => {}); }
      return 'first';
    });
    const agent = new Agent({ driver: driver(calls), tools: { read, write }, messages: [], budget: new RunBudget(), ...policies,
      signal: controller.signal, saveCheckpoint: async value => { saved = structuredClone(value); } });
    await expect(agent.run()).rejects.toBeDefined();
    expect(saved.pending).toMatchObject({ next: 0, started: false });
    expect(write).not.toHaveBeenCalled();
    const provider = driver();
    vi.mocked(provider.turn).mockResolvedValue({ text: 'done', messages: ['done'], calls: [] });
    const resumed = new Agent({ driver: provider, tools: { read: async () => 'fresh', write }, messages: [],
      checkpoint: saved, budget: new RunBudget(), ...policies });
    expect(await resumed.run()).toBe('done');
    expect(write).toHaveBeenCalledOnce();
  });

  it('does not parallelize a tool unless both host policies allow it', async () => {
    const gate = deferred();
    const read = vi.fn(async () => { if (read.mock.calls.length === 1) await gate.promise; return 'ok'; });
    const agent = new Agent({ driver: driver(), tools: { read }, messages: [], budget: new RunBudget(), canParallelTool: () => true });
    const running = agent.run();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    gate.resolve('go');
    await running;
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('FIFO tool scheduling', () => {
  it('cancels active readers and never starts waiting effects after a fatal failure', async () => {
    const scheduler = new ToolScheduler();
    const gate = deferred();
    const error = new AgentPersistenceError('storage failed');
    let siblingSignal!: AbortSignal;
    const write = vi.fn();
    const first = scheduler.run(true, async () => { await gate.promise; throw error; });
    const sibling = scheduler.run(true, signal => new Promise((_, reject) => {
      siblingSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const pending = scheduler.run(false, write);
    const outcomes = Promise.allSettled([first, sibling, pending]);
    await vi.waitFor(() => expect(siblingSignal).toBeDefined());
    gate.resolve('fail');
    await outcomes;
    expect(siblingSignal.aborted).toBe(true);
    expect(write).not.toHaveBeenCalled();
    await expect(scheduler.settled()).rejects.toBe(error);
  });
});
