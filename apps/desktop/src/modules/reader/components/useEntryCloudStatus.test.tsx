// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEntryCloudStatus } from './useEntryCloudStatus';
const api = vi.hoisted(() => ({ cloudAccount: vi.fn(), onCloudLibraryChanged: vi.fn(() => () => {}) }));
vi.mock('@/shared/ipc/cloudAccountApi', () => api);
beforeEach(() => { vi.clearAllMocks(); Object.defineProperty(window, '__TAURI_INTERNALS__', {configurable: true, value: {}}); });
afterEach(() => { cleanup(); vi.useRealTimers(); Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); });
it('reads actual per-entry confirmations', async () => {
  api.cloudAccount.mockResolvedValue({ a: 'synced', b: 'pending', c: 'source' });
  const view = renderHook(() => useEntryCloudStatus('library',true));
  await waitFor(() => expect(view.result.current?.states.a).toBe('synced'));
  expect(view.result.current?.states.b).toBe('pending');
});
it('does not present stale confirmations after switching libraries', async () => {
  api.cloudAccount.mockResolvedValueOnce({a:'synced'}).mockImplementation(() => new Promise(() => {}));
  const view = renderHook(({root}) => useEntryCloudStatus(root,true),{initialProps:{root:'one'}});
  await waitFor(() => expect(view.result.current?.states.a).toBe('synced'));
  view.rerender({root:'two'});
  expect(view.result.current).toBeNull();
});
it('shows unavailable rather than synced when inspection fails', async () => {
  api.cloudAccount.mockRejectedValue(new Error('offline'));
  const view = renderHook(() => useEntryCloudStatus('library',true));
  await waitFor(() => expect(view.result.current?.error).toBe(true));
  expect(view.result.current?.states).toEqual({});
});
it('does not inspect an idle library every thirty seconds', async () => {
  vi.useFakeTimers();
  api.cloudAccount.mockResolvedValue({ a: 'synced' });
  renderHook(() => useEntryCloudStatus('library', true));
  await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
  expect(api.cloudAccount).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(api.cloudAccount).toHaveBeenCalledTimes(2);
});
it('refreshes when saved entries change', async () => {
  api.cloudAccount.mockResolvedValue({ a: 'synced' });
  const view = renderHook(({revision}) => useEntryCloudStatus('library', true, revision), {initialProps:{revision:1}});
  await waitFor(() => expect(view.result.current?.states.a).toBe('synced'));
  api.cloudAccount.mockResolvedValue({ a: 'pending' });
  view.rerender({revision:2});
  await waitFor(() => expect(view.result.current?.states.a).toBe('pending'));
});
