// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/shared/ipc/workspaceApi';
import { useEntryTranslationTask } from './useEntryTranslationTask';

const { listeners, unlisten } = vi.hoisted(() => ({ listeners: new Set<(event: { payload: unknown }) => void>(), unlisten: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_: string, handler: (event: { payload: unknown }) => void) => {
  listeners.add(handler);
  return () => { listeners.delete(handler); unlisten(); };
}) }));
vi.mock('@/shared/ipc/workspaceApi', () => ({
  listJobs: vi.fn(), readEntryTranslation: vi.fn(), runEntryTranslation: vi.fn(), pauseEntryTranslation: vi.fn(), cancelTranslationTask: vi.fn(), resumeEntryTranslation: vi.fn(),
}));

function job(status: api.Job['status'] = 'processing', id = 'job-1'): api.Job {
  return { id, kind: 'translation', status, scope: { kind: 'entry', root: 'root', entry_id: 'entry' },
    progress: { current: 1, total: 10, percent: 10 }, message: '正在翻译 · 已接收 10 字', error: null,
    created_at: '2026-09-26T00:00:00Z', updated_at: status === 'paused' || status === 'canceled' ? '2026-09-26T00:00:01Z' : '2026-09-26T00:00:00Z' };
}
function translation(status: api.TranslationStatus): api.EntryTranslation {
  return { schema_version: 1, entry_id: 'entry', status, source_language: 'en', target_language: 'zh-CN',
    progress: { total: 10, translated: 1, skipped: 0, failed: 0 }, segments: [], model: null,
    error: null, paper_context: null, created_at: '', updated_at: '',
    task: status === 'running' || status === 'paused' ? { job_id: 'job-1', profile_id: 'model', force: true, source_hashes: { p1: 'a', p2: 'b' }, remaining_segment_uids: ['p2'], created_at: '' } : null };
}
function emit(next: api.Job, payload: unknown = null) {
  act(() => { listeners.forEach(handler => handler({ payload: { job: next, kind: next.status, payload } })); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function running() {
  const view = renderHook(() => useEntryTranslationTask({ entryId: 'entry', workspaceRoot: 'root' }));
  await waitFor(() => expect(view.result.current.activeJob?.id).toBe('job-1'));
  return view;
}
beforeEach(() => {
  vi.clearAllMocks(); listeners.clear();
  vi.mocked(api.readEntryTranslation).mockResolvedValue({ translation: translation('running') });
  vi.mocked(api.listJobs).mockResolvedValue([job()]);
  vi.mocked(api.pauseEntryTranslation).mockResolvedValue(job());
  vi.mocked(api.cancelTranslationTask).mockResolvedValue({ job: job(), translation: translation('running') });
  vi.mocked(api.resumeEntryTranslation).mockResolvedValue({ job: { ...job(), updated_at: '2026-09-26T00:00:02Z' }, translation: translation('running') });
});
afterEach(cleanup);

describe('translation lifecycle', () => {
  it('refreshes every mounted view from disk after completion even when the event has a snapshot', async () => {
    const left = await running(), right = await running();
    const saved = { ...translation('succeeded'), updated_at: 'fresh-on-disk' };
    vi.mocked(api.readEntryTranslation).mockResolvedValue({ translation: saved });
    emit(job('succeeded'), { translation: translation('partial') });
    await waitFor(() => expect(left.result.current.translation).toEqual(saved));
    expect(right.result.current.translation).toEqual(saved);
    expect(left.result.current.translationBusy).toBe(false);
  });

  it('shares manually refreshed segment translations with the duplicate view only', async () => {
    const left = await running(), right = await running();
    const other = renderHook(() => useEntryTranslationTask({ entryId: 'other', workspaceRoot: 'root' }));
    await waitFor(() => expect(other.result.current.translation).not.toBeNull());
    const saved = { ...translation('partial'), updated_at: 'segment-complete' };
    vi.mocked(api.readEntryTranslation).mockResolvedValue({ translation: saved });
    await act(async () => { await left.result.current.reloadTranslation(); });
    expect(right.result.current.translation).toEqual(saved);
    expect(other.result.current.translation?.updated_at).not.toBe('segment-complete');
  });
  it.each(['pause', 'cancel'] as const)('%s stays pending until the worker stops; progress cannot overwrite it', async action => {
    const view = await running();
    await act(async () => { await (action === 'pause' ? view.result.current.pauseTranslation() : view.result.current.cancelTranslation()); });
    emit({ ...job(), message: '正在翻译 · 已接收 100 字' });
    expect(view.result.current.stopPending).toBe(action);
    expect(view.result.current.translationBusy).toBe(true);
    expect(view.result.current.translationMessage).toBe(action === 'pause' ? '正在暂停翻译…' : '正在取消翻译…');
    // Duplicate clicks must not dispatch a second command.
    await act(async () => { await view.result.current.cancelTranslation(); });
    expect(vi.mocked(api.pauseEntryTranslation).mock.calls.length + vi.mocked(api.cancelTranslationTask).mock.calls.length).toBe(1);
    const saved = translation(action === 'pause' ? 'paused' : 'canceled');
    emit({ ...job(action === 'pause' ? 'paused' : 'canceled'), message: action === 'pause' ? '已暂停全文翻译' : '已取消全文翻译' }, { translation: saved });
    expect(view.result.current.stopPending).toBeNull();
    expect(view.result.current.translationBusy).toBe(false);
    expect(view.result.current.translation).toEqual(saved);
    emit(job());
    expect(view.result.current.translationBusy).toBe(false);
  });

  it('a failed stop allows retry without pretending the job is stopped', async () => {
    const view = await running();
    vi.mocked(api.cancelTranslationTask).mockRejectedValueOnce(new Error('offline'));
    await act(async () => { await expect(view.result.current.cancelTranslation()).rejects.toThrow('offline'); });
    expect(view.result.current.stopPending).toBeNull();
    expect(view.result.current.translationBusy).toBe(true);
    await act(async () => { await view.result.current.cancelTranslation(); });
    expect(api.cancelTranslationTask).toHaveBeenCalledTimes(2);
  });

  it('late start and stop responses never resurrect a terminal job', async () => {
    const start = deferred<api.RunEntryTranslationResponse>();
    const stop = deferred<api.Job | null>();
    vi.mocked(api.runEntryTranslation).mockReturnValue(start.promise);
    vi.mocked(api.pauseEntryTranslation).mockReturnValue(stop.promise);
    const view = await running();
    let startResult!: Promise<unknown>;
    let stopResult!: Promise<unknown>;
    act(() => { startResult = view.result.current.startTranslation('resume'); });
    emit(job());
    act(() => { stopResult = view.result.current.pauseTranslation(); });
    emit(job('paused'), { translation: translation('paused') });
    await act(async () => {
      start.resolve({ job: job('queued'), translation: translation('running') });
      stop.resolve(job('queued'));
      await Promise.all([startResult, stopResult]);
    });
    expect(view.result.current.translationBusy).toBe(false);
    expect(view.result.current.activeJob?.status).toBe('paused');
    expect(view.result.current.translation?.status).toBe('paused');
  });

  it('ignores old workspace responses and releases listeners on unmount', async () => {
    const start = deferred<api.RunEntryTranslationResponse>();
    vi.mocked(api.runEntryTranslation).mockReturnValue(start.promise);
    const view = renderHook(({ root }) => useEntryTranslationTask({ entryId: 'entry', workspaceRoot: root }), { initialProps: { root: 'root' } });
    await waitFor(() => expect(view.result.current.activeJob).not.toBeNull());
    let pending!: Promise<unknown>;
    act(() => { pending = view.result.current.startTranslation('resume'); });
    vi.mocked(api.listJobs).mockResolvedValue([]);
    vi.mocked(api.readEntryTranslation).mockResolvedValue({ translation: null });
    view.rerender({ root: 'other' });
    await act(async () => { start.resolve({ job: job(), translation: translation('running') }); await pending; });
    expect(view.result.current.activeJob).toBeNull();
    expect(view.result.current.translation).toBeNull();
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(listeners.size).toBe(0);
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it('reopens a paused task as idle and resumes the same id without starting a new task', async () => {
    vi.mocked(api.readEntryTranslation).mockResolvedValue({ translation: translation('paused') });
    vi.mocked(api.listJobs).mockResolvedValue([job('paused')]);
    const view = await running();
    expect(view.result.current.translationBusy).toBe(false);
    expect(view.result.current.translationPaused).toBe(true);
    await act(async () => { await view.result.current.resumeTranslation(); });
    expect(api.resumeEntryTranslation).toHaveBeenCalledWith('root', 'entry', 'job-1');
    expect(api.runEntryTranslation).not.toHaveBeenCalled();
    expect(view.result.current.activeJob?.id).toBe('job-1');
    expect(view.result.current.translationBusy).toBe(true);
    expect(view.result.current.translationPaused).toBe(false);
    emit({ ...job('paused'), updated_at: '2026-09-26T00:00:03Z' }, { translation: translation('paused') });
    expect(view.result.current.translationPaused).toBe(true);
  });

  it('a failed resume keeps the task paused; cancel removes the resumable task', async () => {
    vi.mocked(api.readEntryTranslation).mockResolvedValue({ translation: translation('paused') });
    vi.mocked(api.listJobs).mockResolvedValue([job('paused')]);
    vi.mocked(api.resumeEntryTranslation).mockRejectedValueOnce(new Error('model removed'));
    const view = await running();
    await act(async () => { await expect(view.result.current.resumeTranslation()).rejects.toThrow('model removed'); });
    expect(view.result.current.stopPending).toBeNull();
    expect(view.result.current.translationPaused).toBe(true);
    vi.mocked(api.cancelTranslationTask).mockResolvedValue({ job: job('canceled'), translation: translation('canceled') });
    await act(async () => { await view.result.current.cancelTranslation(); });
    expect(view.result.current.translation?.task).toBeNull();
    expect(view.result.current.translationPaused).toBe(false);
    await expect(view.result.current.resumeTranslation()).rejects.toThrow('没有可继续');
    expect(api.resumeEntryTranslation).toHaveBeenCalledTimes(1);
  });
});
