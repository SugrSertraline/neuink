// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCloudSync } from './useCloudSync';
import { getLocalBackgroundJobs } from '@/shared/lib/localBackgroundJobs';
const mocks = vi.hoisted(() => ({ call: vi.fn(), listener: vi.fn(), stop: vi.fn() }));
vi.mock('@/shared/ipc/cloudAccountApi', () => ({ cloudAccount: mocks.call }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listener }));
afterEach(() => { cleanup(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; vi.clearAllMocks(); });
it('keeps task progress independent of the settings window and publishes confirmed completion', async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  let notify!: (event: unknown) => void;
  mocks.listener.mockImplementation(async (_name, listener) => { notify = listener; return mocks.stop; });
  const view = renderHook(() => useCloudSync(null, false));
  await waitFor(() => expect(mocks.listener).toHaveBeenCalled());
  const task = { id: 7812, running: true, cancelled: false, result: null, error: null,
    progress: { phase: 'uploading', confirmed_bytes: 100, total_bytes: 200, published: 0, received: 0, applied: 0 } };
  act(() => notify({ payload: { root: 'test-library', automatic: false, task } }));
  expect(getLocalBackgroundJobs().find(j => j.id === 'cloud-task:7812')?.progress.percent).toBe(50);
  expect(getLocalBackgroundJobs().find(j => j.id === 'cloud-task:7812')?.message).not.toContain('0.0 / 0.0 MB');
  act(() => notify({ payload: { root: 'test-library', automatic: true, task: { ...task,
    progress: { ...task.progress, phase: 'downloading', confirmed_bytes: 0, total_bytes: 0 } } } }));
  expect(getLocalBackgroundJobs().find(j => j.id === 'cloud-task:7812')?.message).toBe('正在检查待接收内容…');
  act(() => notify({ payload: { root: 'test-library', automatic: true, task: { ...task,
    progress: { ...task.progress, phase: 'checking', scanned: 2, scan_total: 8 } } } }));
  expect(getLocalBackgroundJobs().find(j => j.id === 'cloud-task:7812')?.message).toBe('核对同步结果 · 已检查 2 / 8 个条目');
  expect(getLocalBackgroundJobs().find(j => j.id === 'cloud-task:7812')?.progress.percent).toBe(25);
  act(() => notify({ payload: { root: 'test-library', automatic: false, task: { ...task, running: false,
    result: { published: 1, received: 0, applied: 0, conflicts: 0, failures: [] } } } }));
  expect(getLocalBackgroundJobs().find(j => j.id === 'cloud-task:7812')?.status).toBe('succeeded');
  act(() => notify({ payload: { root: 'test-library', automatic: true, task: { ...task, id: 7813, running: false,
    result: { uploads_blocked: true, published: 0, received: 2, applied: 2, conflicts: 0, failures: [] } } } }));
  expect(getLocalBackgroundJobs().find(j => j.id === 'cloud-task:7813')?.status).toBe('failed');
  act(() => notify({ payload: { root: 'test-library', automatic: true, task: { ...task, id: 7814, running: false,
    result: { published: 0, received: 0, applied: 0, conflicts: 0, failures: [['board:ideation', '来源条目、解析或标签依赖尚未就绪，已保留待同步内容']] } } } }));
  expect(getLocalBackgroundJobs().find(j => j.id === 'cloud-task:7814')?.message).toContain('board:ideation');
  expect(getLocalBackgroundJobs().find(j => j.id === 'cloud-task:7814')?.message).not.toContain('冲突');
  view.unmount(); expect(mocks.stop).toHaveBeenCalledOnce();
});
