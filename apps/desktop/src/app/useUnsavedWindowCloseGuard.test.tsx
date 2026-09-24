// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useUnsavedWindowCloseGuard } from './useUnsavedWindowCloseGuard';
import { setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { setAssistantBackgroundRun, finishAssistantBackgroundRun, stopAssistantBackgroundRun } from '@/modules/assistant/components/assistantBackgroundRuns';

const mocked = vi.hoisted(() => ({ listener: null as null | ((event: { preventDefault: () => void }) => void), unlisten: vi.fn(), notify: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: mocked.isTauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async (listener: typeof mocked.listener) => { mocked.listener = listener; return mocked.unlisten; } }) }));
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: mocked.notify }) }));
afterEach(() => { cleanup(); setAssistantBackgroundRun(null); setSegmentEditorDirty('pdf:exit', 'owner', false); vi.clearAllMocks(); });

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

it('protects tasks in other libraries, including stopping tasks until final persistence settles', async () => {
  const view = renderHook(() => useUnsavedWindowCloseGuard());
  await act(async () => {});
  const controller = new AbortController();
  setAssistantBackgroundRun({ abortController: controller, root: 'other-library', question: 'Waiting for input', conversation: null,
    conversationId: 'background', error: null, noteProposalsByMessageId: {}, streamingMessageId: null, toolEventsByMessageId: {} });
  const preventDefault = vi.fn();
  mocked.listener?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(mocked.notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: '仍有 1 个助手任务未结束' }));
  const reload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(reload);
  expect(reload.defaultPrevented).toBe(true);
  stopAssistantBackgroundRun(controller);
  mocked.listener?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(2);
  finishAssistantBackgroundRun(controller);
  mocked.listener?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(2);
  view.unmount();
  const afterUnmount = new Event('beforeunload', { cancelable: true });
  setSegmentEditorDirty('pdf:exit', 'owner', true);
  window.dispatchEvent(afterUnmount);
  expect(afterUnmount.defaultPrevented).toBe(false);
});

it('does not accumulate close listeners after repeated mounting', async () => {
  for (let i = 0; i < 100; i++) {
    const view = renderHook(() => useUnsavedWindowCloseGuard());
    view.unmount();
    await act(async () => {});
  }
  expect(mocked.unlisten).toHaveBeenCalledTimes(100);
});
