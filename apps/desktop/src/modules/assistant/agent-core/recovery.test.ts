import { describe, expect, it, vi } from 'vitest';
import { Agent, AgentPersistenceError, RunBudget, type AgentCheckpoint, type AgentDriver } from './agent';

const call = { id: 'write-1', name: 'write', input: { title: 'Note' } };
function driver(): AgentDriver<string> {
  let turn = 0;
  return { turn: vi.fn(async () => ++turn === 1
    ? { text: '', messages: ['call'], calls: [call] }
    : { text: 'done', messages: ['done'], calls: [] }),
    result: (_, output) => JSON.stringify(output), instruction: text => text };
}

describe('durable kernel recovery', () => {
  it.each([
    { messages: [], turns: -1 },
    { messages: null, turns: 1 },
    { messages: [], turns: 1, answer: 42 },
    { messages: [], turns: 1, pending: { response: { text: '', messages: [], calls: [call] }, next: 2, started: false } },
    { messages: [], turns: 1, pending: { response: { text: '', messages: [], calls: [] }, next: 0, started: true } },
  ])('rejects malformed execution state before invoking anything: %j', saved => {
    const provider = driver();
    const write = vi.fn();
    expect(() => new Agent({ driver: provider, checkpoint: saved as unknown as AgentCheckpoint<string>,
      messages: [], tools: { write }, budget: new RunBudget() })).toThrow('执行状态无效');
    expect(provider.turn).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects invalid budgets atomically, including missing snapshots', () => {
    const budget = new RunBudget();
    budget.turn();
    const before = budget.snapshot();
    expect(() => budget.restore({ ...before, turns: 12, toolCalls: -1 })).toThrow('预算记录无效');
    expect(budget.snapshot()).toEqual(before);
    expect(() => budget.restore(undefined as never)).toThrow('预算记录无效');
  });
  it('preserves classified persistence errors through the core boundary', async () => {
    const error = new AgentPersistenceError('会话标识校验失败');
    const provider = driver();
    await expect(new Agent({ driver: provider, messages: ['question'], tools: {}, budget: new RunBudget(),
      saveCheckpoint: async () => { throw error; } }).run()).rejects.toBe(error);
    expect(provider.turn).not.toHaveBeenCalled();
  });
  it('never repeats a completed side effect after the next model request fails', async () => {
    let saved!: AgentCheckpoint<string>;
    const provider = driver();
    vi.mocked(provider.turn).mockResolvedValueOnce({ text: '', messages: ['call'], calls: [call] }).mockRejectedValueOnce(new Error('network'));
    const write = vi.fn(async () => ({ id: 'entry-1' }));
    const saveCheckpoint = async (value: AgentCheckpoint<string>) => { saved = structuredClone(value); };
    const budget = new RunBudget();
    await expect(new Agent({ driver: provider, messages: ['question'], tools: { write }, budget, saveCheckpoint }).run()).rejects.toThrow('network');
    expect(write).toHaveBeenCalledOnce();
    const next = driver();
    vi.mocked(next.turn).mockResolvedValue({ text: 'recovered', messages: ['recovered'], calls: [] });
    expect(await new Agent({ driver: next, messages: [], tools: { write }, budget, checkpoint: saved, saveCheckpoint }).run()).toBe('recovered');
    expect(write).toHaveBeenCalledOnce();
    expect(budget.turns).toBe(3);
    expect(saved.messages).toContain('{"id":"entry-1"}');
  });
  it('blocks an uncertain write but permits explicit read-only replay', async () => {
    const checkpoint: AgentCheckpoint<string> = { messages: ['question', 'call'], turns: 1,
      pending: { response: { text: '', messages: ['call'], calls: [call] }, next: 0, started: true } };
    const write = vi.fn();
    await expect(new Agent({ driver: driver(), messages: [], tools: { write }, budget: new RunBudget(), checkpoint: structuredClone(checkpoint) }).run()).rejects.toThrow('执行结果尚未确认');
    expect(write).not.toHaveBeenCalled();
    const readOnly = vi.fn(async () => 'evidence');
    const provider = driver();
    vi.mocked(provider.turn).mockResolvedValue({ text: 'done', messages: ['done'], calls: [] });
    await new Agent({ driver: provider, messages: [], tools: { write: readOnly }, budget: new RunBudget(),
      checkpoint: structuredClone(checkpoint), canReplayTool: () => true }).run();
    expect(readOnly).toHaveBeenCalledOnce();
  });
  it('fails closed when a write-ahead checkpoint cannot be saved', async () => {
    const write = vi.fn();
    let saves = 0;
    const saveCheckpoint = async () => { if (++saves === 3) throw new Error('disk full'); };
    await expect(new Agent({ driver: driver(), messages: ['question'], tools: { write }, budget: new RunBudget(), saveCheckpoint }).run()).rejects.toThrow('检查点保存失败');
    expect(write).not.toHaveBeenCalled();
  });
  it('does not ask the model to retry a failed write with an uncertain outcome', async () => {
    const write = vi.fn(async () => { throw new Error('connection lost after commit'); });
    const provider = driver();
    await expect(new Agent({ driver: provider, messages: ['question'], tools: { write }, budget: new RunBudget(),
      saveCheckpoint: async () => {} }).run()).rejects.toThrow('无法确认是否已产生修改');
    expect(write).toHaveBeenCalledOnce();
    expect(provider.turn).toHaveBeenCalledOnce();
  });
  it('returns a saved final response even if the turn budget has been exhausted', async () => {
    const provider = driver();
    const checkpoint = { messages: ['question', 'answer'], turns: 12, answer: 'answer' };
    expect(await new Agent({ driver: provider, checkpoint, messages: [], tools: {}, budget: new RunBudget() }).run()).toBe('answer');
    expect(provider.turn).not.toHaveBeenCalled();
  });
  it('waits for event listeners and steers at a completed tool batch boundary', async () => {
    const provider = driver();
    const events: string[] = [];
    const agent = new Agent({ driver: provider, messages: ['question'], tools: { write: async () => 'ok' }, budget: new RunBudget() });
    agent.subscribe(async event => {
      await Promise.resolve();
      events.push(event.type);
      if (event.type === 'tool_end') agent.steer('Compare before writing anything else');
    });
    await agent.run();
    expect(agent.messages).toContain('Compare before writing anything else');
    expect(events).toEqual(['agent_start', 'turn_start', 'tool_start', 'tool_end', 'turn_end', 'turn_start', 'turn_end', 'agent_end']);
  });
  it('runs queued follow-ups and does not become idle before final listeners settle', async () => {
    let finish!: () => void;
    const barrier = new Promise<void>(resolve => { finish = resolve; });
    const provider = driver();
    const agent = new Agent({ driver: provider, messages: ['question'], tools: { write: async () => 'ok' }, budget: new RunBudget() });
    agent.followUp('Summarize the result');
    agent.subscribe(event => event.type === 'agent_end' ? barrier : undefined);
    const run = agent.run();
    let idle = false;
    const waiting = agent.waitForIdle().then(() => { idle = true; });
    await vi.waitFor(() => expect(provider.turn).toHaveBeenCalledTimes(3));
    expect(idle).toBe(false);
    finish();
    await Promise.all([run, waiting]);
    expect(idle).toBe(true);
    expect(agent.messages).toContain('Summarize the result');
  });
});
