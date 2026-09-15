// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useUnsavedWindowCloseGuard } from './useUnsavedWindowCloseGuard';
import { setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';

const mocked = vi.hoisted(() => ({ listener: null as null | ((event: { preventDefault: () => void }) => void), unlisten: vi.fn(), notify: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: mocked.isTauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async (listener: typeof mocked.listener) => { mocked.listener = listener; return mocked.unlisten; } }) }));
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: mocked.notify }) }));
afterEach(() => { cleanup(); setSegmentEditorDirty('pdf:exit', 'owner', false); vi.clearAllMocks(); });

it('blocks native exit and reload for dirty fragments, and permits clean exit', async () => {
  const view = renderHook(() => useUnsavedWindowCloseGuard());
  await act(async () => {});
  const preventDefault = vi.fn();
  mocked.listener?.({ preventDefault });
  expect(preventDefault).not.toHaveBeenCalled();
  setSegmentEditorDirty('entry-content:exit|pdf', 'owner', true);
  mocked.listener?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(mocked.notify).toHaveBeenCalledOnce();
  const reload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(reload);
  expect(reload.defaultPrevented).toBe(true);
  view.unmount();
  expect(mocked.unlisten).toHaveBeenCalledOnce();
});

it('cleans up native subscriptions that finish after unmount', async () => {
  const view = renderHook(() => useUnsavedWindowCloseGuard());
  view.unmount();
  await act(async () => {});
  expect(mocked.unlisten).toHaveBeenCalledOnce();
});
