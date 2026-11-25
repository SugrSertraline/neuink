import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { runResearchTool } from './researchApi';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('cancels just one of two simultaneous arxiv calls and cleans listeners after success and failure', async () => {
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const requests: Array<{ call_id: string; args: { query: string }; root: string }> = [];
  vi.mocked(invoke).mockImplementation((command, input) => {
    if (command !== 'run_research_tool') return Promise.resolve(undefined) as ReturnType<typeof invoke>;
    const request = (input as { request: typeof requests[number] }).request;
    requests.push(request);
    return new Promise((resolve, reject) => pending.set(request.call_id, { resolve, reject }));
  });
  const a = new AbortController(), b = new AbortController();
  const cleanA = vi.spyOn(a.signal, 'removeEventListener'), cleanB = vi.spyOn(b.signal, 'removeEventListener');
  const first = runResearchTool('arxiv_search', { root: 'host-A', mode: 'structured', query: 'A' }, a.signal);
  const second = runResearchTool('arxiv_search', { root: 'host-B', mode: 'structured', query: 'B' }, b.signal);
  const rejected = expect(first).rejects.toThrow('cancelled');
  expect(requests[0].call_id).not.toBe(requests[1].call_id);
  a.abort();
  expect(vi.mocked(invoke).mock.calls.filter(call => call[0] === 'cancel_research_call')).toEqual([
    ['cancel_research_call', { callId: requests[0].call_id }],
  ]);
  pending.get(requests[0].call_id)!.reject(new Error('cancelled'));
  pending.get(requests[1].call_id)!.resolve({ status: 'ok', papers: [], returned_count: 0 });
  await rejected;
  await expect(second).resolves.toMatchObject({ status: 'ok', returned_count: 0 });
  expect(cleanA).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(cleanB).toHaveBeenCalledWith('abort', expect.any(Function));
  b.abort();
  expect(vi.mocked(invoke).mock.calls.filter(call => call[0] === 'cancel_research_call')).toHaveLength(1);
  expect(requests.map(request => [request.root, request.args.query])).toEqual([['host-A', 'A'], ['host-B', 'B']]);
  console.log('R2_JSON ' + JSON.stringify({ case_id: 'T-R2-IPC-CONCURRENT-CANCEL', actual: {
    simultaneous_calls: 2, unique_call_ids: 2, cancel_calls: 1, cancelled: 'A', completed: 'B',
    listeners_removed: 2, post_settle_cancel_calls: 0, native_mocked: true, real_network: false,
  } }));
});

it('dispatches no native request for an already stopped arxiv call', async () => {
  const controller = new AbortController();
  controller.abort(new Error('R2 pre-cancelled'));
  await expect(runResearchTool('arxiv_search', { root: 'host-A', mode: 'ids', ids: ['1706.03762v1'] }, controller.signal)).rejects.toThrow('R2 pre-cancelled');
  expect(invoke).not.toHaveBeenCalled();
  console.log('R2_JSON ' + JSON.stringify({ case_id: 'T-R2-IPC-PRECANCEL', actual: { native_dispatches: 0, native_mocked: true } }));
});
