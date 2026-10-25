// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { runLocalAgent, testLocalAgentConnection, type LocalAgentEvent } from './localAgentApi';
vi.mock('@tauri-apps/api/core', () => ({invoke:vi.fn(), isTauri:vi.fn(() => true), Channel:class {onmessage?: (value:unknown) => void;}}));
const request = {runId:'run1',root:'fixture',conversationId:'c1',prompt:'hello',sessionId:'s1',resume:false,tools:[]};
let receive: (event:LocalAgentEvent) => void;
let finish: (result:Record<string,unknown>) => void;
let reject: (error:unknown) => void;
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockImplementation((command,args) => {
    if (command !== 'run_local_agent') return Promise.resolve(undefined) as never;
    receive = (args as {onEvent:{onmessage:typeof receive}}).onEvent.onmessage;
    return new Promise((resolve,fail) => {finish = resolve as typeof finish; reject = fail;});
  });
});
describe('local Agent IPC lifecycle', () => {
  it('tests a model with no workspace payload and cancels through the existing run registry', async () => {
    const controller = new AbortController();
    let finishProbe!: () => void;
    vi.mocked(invoke).mockImplementation((name) => name === 'test_local_agent_connection'
      ? new Promise<void>(resolve => { finishProbe = resolve; }) as never : Promise.resolve() as never);
    const probe = testLocalAgentConnection('codex', controller.signal);
    const request = vi.mocked(invoke).mock.calls[0][1];
    expect(request).toEqual({ provider: 'codex', runId: expect.any(String) });
    controller.abort(); finishProbe();
    await expect(probe).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).toHaveBeenCalledWith('cancel_local_agent', { runId: (request as { runId: string }).runId });
    vi.mocked(invoke).mockClear();
    await expect(testLocalAgentConnection('claude', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('streams, answers tools once and ignores events after terminal result', async () => {
    const event = vi.fn(), tool = vi.fn(async () => ({content:[]}));
    const run = runLocalAgent(request,undefined,event,tool);
    receive({type:'message',value:{type:'assistant'}});
    receive({type:'tool',id:'q1',name:'read_note',input:{}});
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('respond_local_agent',expect.objectContaining({requestId:'q1'})));
    finish({result:'done'}); await expect(run).resolves.toEqual({result:'done'});
    receive({type:'message',value:{late:true}}); receive({type:'tool',id:'late',name:'read_note',input:{}});
    expect(event).toHaveBeenCalledOnce(); expect(tool).toHaveBeenCalledOnce();
  });
  it('handles cancellation before startup and during a pending tool without replying late', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runLocalAgent(request,controller.signal,vi.fn(),vi.fn())).rejects.toMatchObject({name:'AbortError'});
    expect(invoke).not.toHaveBeenCalled();
    const active = new AbortController(); let resolve!: () => void;
    const tool = vi.fn(() => new Promise<void>(done => {resolve = done;}));
    const run = runLocalAgent(request,active.signal,vi.fn(),tool);
    receive({type:'tool',id:'q',name:'read_note',input:{}}); active.abort(); resolve();
    reject('任务已停止。'); await expect(run).rejects.toMatchObject({name:'AbortError'});
    expect(invoke).toHaveBeenCalledWith('cancel_local_agent',{runId:'run1'});
    expect(vi.mocked(invoke).mock.calls.some(call => call[0] === 'respond_local_agent')).toBe(false);
  });
  it('stops on protocol errors, tool-response delivery failure and unavailable desktop', async () => {
    const run = runLocalAgent(request,undefined,() => {throw new Error('MCP disconnected');},vi.fn());
    receive({type:'message',value:{}}); reject('stopped');
    await expect(run).rejects.toThrow('MCP disconnected');
    expect(invoke).toHaveBeenCalledWith('cancel_local_agent',{runId:'run1'});
    vi.mocked(invoke).mockImplementationOnce(() => Promise.reject('连接失败'));
    await expect(runLocalAgent(request,undefined,vi.fn(),vi.fn())).rejects.toThrow('连接失败');
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(runLocalAgent(request,undefined,vi.fn(),vi.fn())).rejects.toThrow('桌面应用');
  });
  it('returns a safe tool failure envelope', async () => {
    const run = runLocalAgent(request,undefined,vi.fn(),async () => {throw new Error('secret');});
    receive({type:'tool',id:'q',name:'bad',input:{}});
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('respond_local_agent',expect.objectContaining({output:{isError:true,content:[{type:'text',text:expect.not.stringContaining('secret')}]}})));
    finish({result:'done'}); await run;
  });
  it('stops and reports a tool-response delivery failure', async () => {
    const run = runLocalAgent(request,undefined,vi.fn(),async () => ({content:[]}));
    vi.mocked(invoke).mockImplementationOnce(() => Promise.reject('private connection error'));
    receive({type:'tool',id:'q',name:'read_note',input:{}});
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('cancel_local_agent',{runId:'run1'}));
    reject('任务已停止。'); await expect(run).rejects.toThrow('工具结果未能送达');
  });
});
