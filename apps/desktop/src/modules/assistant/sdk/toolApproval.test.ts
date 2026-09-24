import { describe, expect, it, vi } from 'vitest';
import { jsonSchema, tool } from 'ai';
import { agentExecutors } from './agentDriver';
import { Agent, RunBudget, type AgentCheckpoint, type AgentDriver } from '../agent-core/agent';

function fixture() {
  const effect = vi.fn(async (_input: { title: string }) => 'written');
  const tools = { write: tool({ needsApproval: true, inputSchema: jsonSchema<{ title: string }>({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }), execute: effect }) };
  const call = { id: 'call-1', name: 'write', input: { title: 'Original' } };
  let turn = 0;
  const driver: AgentDriver<string> = { turn: async () => ++turn === 1 ? { text: '', messages: ['call'], calls: [call] } : { text: 'done', messages: ['done'], calls: [] }, result: () => 'result', instruction: text => text };
  return { effect, tools, driver, call };
}

describe('host-side tool approval boundary', () => {
  it('fails closed without a confirmation host, including direct executor calls', async () => {
    const { effect, tools } = fixture();
    await expect(agentExecutors(tools).write({ title: 'New' }, { id: '1' })).rejects.toThrow('需要用户确认');
    expect(effect).not.toHaveBeenCalled();
  });
  it('validates before prompting and never writes on rejection', async () => {
    const { effect, tools } = fixture();
    const approval = vi.fn(async () => false);
    const execute = agentExecutors(tools, approval).write;
    await expect(execute({ title: 3 }, { id: '1' })).rejects.toThrow('Invalid arguments');
    expect(approval).not.toHaveBeenCalled();
    await expect(execute({ title: 'New' }, { id: '2' })).rejects.toThrow('用户已拒绝');
    expect(effect).not.toHaveBeenCalled();
  });
  it('binds confirmation to a cloned payload and a single invocation', async () => {
    const { effect, tools } = fixture();
    const input = { title: 'Original' };
    const execute = agentExecutors(tools, async request => { (request.input as typeof input).title = 'Changed preview'; input.title = 'Changed call'; return true; }).write;
    const prepared = await execute.prepare!(input, { id: '1' });
    expect(effect).not.toHaveBeenCalled();
    await prepared({ title: 'Different input' }, { id: '1' });
    expect(effect.mock.calls[0][0]).toEqual({ title: 'Original' });
    await expect(prepared(input, { id: '1' })).rejects.toThrow('不能重复');
    expect(effect).toHaveBeenCalledOnce();
  });
  it('keeps a waiting call resumable but asks again after interruption', async () => {
    const { effect, tools, driver } = fixture();
    const abort = new AbortController();
    let checkpoint!: AgentCheckpoint<string>;
    let waiting!: () => void;
    const waitingPromise = new Promise<void>(resolve => { waiting = resolve; });
    const agent = new Agent({ driver, tools: agentExecutors(tools, async () => { waiting(); return new Promise(() => {}); }), messages: [], budget: new RunBudget(), signal: abort.signal,
      saveCheckpoint: async value => { checkpoint = structuredClone(value); } });
    const result = agent.run();
    const rejected = expect(result).rejects.toThrow();
    await waitingPromise;
    expect(checkpoint.pending?.started).toBe(false);
    expect(effect).not.toHaveBeenCalled();
    abort.abort();
    await rejected;
    const approve = vi.fn(async () => true);
    await new Agent({ driver, tools: agentExecutors(tools, approve), messages: [], budget: new RunBudget(), checkpoint }).run();
    expect(approve).toHaveBeenCalledOnce();
    expect(effect).toHaveBeenCalledOnce();
  });
  it('still refuses execution if the write-ahead save fails after consent', async () => {
    const { effect, tools, driver } = fixture();
    await expect(new Agent({ driver, tools: agentExecutors(tools, async () => true), messages: [], budget: new RunBudget(),
      saveCheckpoint: async checkpoint => { if (checkpoint.pending?.started) throw new Error('disk full'); } }).run()).rejects.toThrow('检查点保存失败');
    expect(effect).not.toHaveBeenCalled();
  });
  it('does not execute if stopped at the moment of approval', async () => {
    const { effect, tools, driver } = fixture();
    const abort = new AbortController();
    await expect(new Agent({ driver, tools: agentExecutors(tools, async () => { abort.abort(); return true; }), messages: [], budget: new RunBudget(), signal: abort.signal }).run()).rejects.toThrow();
    expect(effect).not.toHaveBeenCalled();
  });
  it('leaves read-only tools automatic', async () => {
    const { tools, effect } = fixture();
    tools.write.needsApproval = false;
    const approve = vi.fn();
    await agentExecutors(tools, approve).write({ title: 'Read' }, { id: 'read' });
    expect(approve).not.toHaveBeenCalled();
    expect(effect).toHaveBeenCalledOnce();
  });
});
