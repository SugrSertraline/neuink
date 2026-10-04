// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { listJobs, type Job, type JobEvent } from '@/shared/ipc/workspaceApi';
import { mergeBackgroundJobs, recentBackgroundJobs } from '@/shared/lib/backgroundJobs';
import { useWorkspaceJobs } from './useWorkspaceJobs';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@/shared/ipc/workspaceApi', () => ({ listJobs: vi.fn() }));
let emit: (event: { payload: JobEvent }) => void;
const unlisten = vi.fn();
const job = (id: string, status: Job['status'] = 'processing', root = 'A', updated_at = '2026-10-03T00:00:00Z'): Job => ({
  id, status, scope: { kind: 'workspace', root }, kind: 'pdf_import', created_at: '', updated_at,
  error: null, message: '正在下载论文', progress: { current: 0, total: 1, percent: 0 },
});
const event = (value: Job) => ({ payload: { job: value } as JobEvent });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listJobs).mockResolvedValue([]);
  vi.mocked(listen).mockImplementation(async (_name, handler) => {
    emit = handler as typeof emit;
    return unlisten;
  });
});
afterEach(cleanup);

it('retains every active task while bounding completed history', () => {
  const active = Array.from({ length: 30 }, (_, index) => job(`active-${index}`));
  const complete = Array.from({ length: 30 }, (_, index) => job(`done-${index}`, 'succeeded'));
  const recent = recentBackgroundJobs([...complete, ...active]);
  expect(recent).toHaveLength(38);
  expect(recent.slice(0, 30)).toEqual(active);
  expect(mergeBackgroundJobs(complete, active)).toHaveLength(54);
});

it('compares variable-precision backend timestamps as instants', () => {
  const old = job('download', 'processing', 'A', '2026-10-03T00:00:00.123Z');
  const latest = job('download', 'succeeded', 'A', '2026-10-03T00:00:00.123001Z');
  expect(mergeBackgroundJobs([old], [latest])[0].status).toBe('succeeded');
  expect(mergeBackgroundJobs([latest], [old])[0].status).toBe('succeeded');
  const complete = { ...old, id: 'complete', status: 'succeeded' as const };
  expect(recentBackgroundJobs([complete, latest])[0]).toEqual(latest);
});

it('keeps all paused tasks reachable without classifying them as running', async () => {
  const paused = Array.from({ length: 30 }, (_, index) => job(`paused-${index}`, 'paused'));
  const completed = Array.from({ length: 30 }, (_, index) => job(`done-${index}`, 'succeeded', 'A', '2026-10-03T00:01:00Z'));
  expect(recentBackgroundJobs([...completed, ...paused])).toHaveLength(38);
  expect(mergeBackgroundJobs(paused, completed).filter(row => row.status === 'paused')).toHaveLength(30);
  vi.mocked(listJobs).mockResolvedValue([...completed, ...paused]);
  const view = renderHook(() => useWorkspaceJobs('A'));
  await waitFor(() => expect(view.result.current.jobs).toHaveLength(38));
  expect(view.result.current.activeJobs).toHaveLength(0);
});

it('does not resurrect completed imports evicted before the initial snapshot arrives', async () => {
  let resolve!: (jobs: Job[]) => void;
  vi.mocked(listJobs).mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useWorkspaceJobs('A'));
  await waitFor(() => expect(listJobs).toHaveBeenCalledOnce());
  const old = Array.from({ length: 30 }, (_, index) => job(`download-${index}`));
  act(() => old.forEach(row => emit(event({ ...row, status: 'succeeded', updated_at: '2026-10-03T00:00:01Z' }))));
  await act(async () => resolve(old));
  expect(view.result.current.activeJobs).toHaveLength(0);
  expect(view.result.current.jobs).toHaveLength(8);
});

it('subscribes before loading and never lets a stale snapshot overwrite a completion event', async () => {
  let resolve!: (jobs: Job[]) => void;
  vi.mocked(listJobs).mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useWorkspaceJobs('A'));
  await waitFor(() => expect(listJobs).toHaveBeenCalledOnce());
  expect(vi.mocked(listen).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(listJobs).mock.invocationCallOrder[0]);
  act(() => emit(event(job('download', 'succeeded', 'A', '2026-10-03T00:00:02Z'))));
  await act(async () => resolve([job('download')]));
  expect(view.result.current.jobs[0].status).toBe('succeeded');
  expect(view.result.current.activeJobs).toHaveLength(0);
});

it('preserves observed progress on initial list failure, and rejects late older events', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(listJobs).mockImplementation(() => new Promise((_done, fail) => { reject = fail; }));
  const view = renderHook(() => useWorkspaceJobs('A'));
  await waitFor(() => expect(listJobs).toHaveBeenCalledOnce());
  act(() => emit(event(job('download', 'failed', 'A', '2026-10-03T00:00:03Z'))));
  act(() => emit(event(job('download'))));
  await act(async () => reject(new Error('IPC unavailable')));
  expect(view.result.current.jobs[0].status).toBe('failed');
});

it('isolates workspace changes and releases listeners including late subscription', async () => {
  const view = renderHook(({ root }) => useWorkspaceJobs(root), { initialProps: { root: 'A' } });
  await waitFor(() => expect(listJobs).toHaveBeenCalledOnce());
  const emitA = emit;
  act(() => emitA(event(job('old'))));
  expect(view.result.current.jobs).toHaveLength(1);
  view.rerender({ root: 'B' });
  await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(2));
  act(() => emitA(event(job('late'))));
  act(() => emit(event(job('wrong', 'processing', 'A'))));
  expect(view.result.current.jobs).toHaveLength(0);
  act(() => emit(event(job('new', 'processing', 'B'))));
  expect(view.result.current.jobs.map(row => row.id)).toEqual(['new']);
  view.unmount();
  await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(2));

  let finishSubscription!: (stop: () => void) => void;
  const stop = vi.fn();
  vi.mocked(listen).mockImplementation(() => new Promise(resolve => { finishSubscription = resolve; }));
  const late = renderHook(() => useWorkspaceJobs('A'));
  late.unmount();
  await act(async () => finishSubscription(stop));
  expect(stop).toHaveBeenCalledOnce();
});

it('falls back to the snapshot when event registration rejects without an unhandled rejection', async () => {
  vi.mocked(listen).mockRejectedValue(new Error('events unavailable'));
  vi.mocked(listJobs).mockResolvedValue([job('known')]);
  const view = renderHook(() => useWorkspaceJobs('A'));
  await waitFor(() => expect(view.result.current.jobs).toHaveLength(1));
  view.unmount();
});
