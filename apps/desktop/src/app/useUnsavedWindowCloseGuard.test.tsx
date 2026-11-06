// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useUnsavedWindowCloseGuard } from './useUnsavedWindowCloseGuard';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { checkpointEditRecovery, isRecoveryExit } from '@/shared/lib/editRecovery';
import { setAssistantBackgroundRun, finishAssistantBackgroundRun, stopAssistantBackgroundRun, queueAssistantBackgroundRun,
  getAssistantMessageQueues } from '@/modules/assistant/components/assistantBackgroundRuns';
import type { QueuedAssistantDraft } from '@/modules/assistant/components/assistantRunController';

const mocked = vi.hoisted(() => ({ listener: null as null | ((event: { preventDefault: () => void }) => void), unlisten: vi.fn(), notify: vi.fn(), close: vi.fn(async () => {}), isTauri: vi.fn(() => true) }));
const recovery = vi.hoisted(() => ({ write: vi.fn(async () => {}), read: vi.fn(async () => ({ drafts: [], unreadable: 0 })) }));
vi.mock('@/shared/ipc/editRecoveryApi', () => ({ readEditRecovery: recovery.read, writeEditRecovery: recovery.write, removeEditRecovery: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: mocked.isTauri }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: mocked.close, onCloseRequested: async (listener: typeof mocked.listener) => { mocked.listener = listener; return mocked.unlisten; } }) }));
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: mocked.notify }) }));
afterEach(() => { cleanup(); setAssistantBackgroundRun(null); setSegmentEditorDirty('pdf:exit', 'owner', false); vi.clearAllMocks(); });

it('blocks native exit and reload for dirty fragments, and permits clean exit', async () => {
  const reveal = vi.fn();
  const view = renderHook(() => useUnsavedWindowCloseGuard({ onReveal: reveal }));
  await act(async () => {});
  const preventDefault = vi.fn();
  mocked.listener?.({ preventDefault });
  expect(preventDefault).not.toHaveBeenCalled();
  setSegmentEditorDirty('entry-content:exit|pdf', 'owner', true);
  mocked.listener?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(mocked.notify).toHaveBeenCalledOnce();
  expect(reveal).toHaveBeenCalledWith(expect.objectContaining({ scopeKey: 'pdf:exit' }));
  const reload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(reload);
  expect(reload.defaultPrevented).toBe(true);
  view.unmount();
  expect(mocked.unlisten).toHaveBeenCalledOnce();
});

it('checkpoints the latest content before allowing explicit keep-and-exit', async () => {
  const draft = { key: 'note', kind: 'segment-note' as const, ownerId: 'exit', targetId: 's', label: '片段笔记', scopeKey: 'pdf:exit', payload: { text: 'latest content' } };
  const unregister = registerSegmentEditorCloseHandler('pdf:exit', 'owner', {
    discard: vi.fn(), save: vi.fn(async () => false), isDirty: () => true,
    checkpoint: () => checkpointEditRecovery('close-test', draft), recovery: () => ({ root: 'close-test', key: draft.key })
  });
  const view = renderHook(() => useUnsavedWindowCloseGuard());
  setSegmentEditorDirty('pdf:exit', 'owner', true);
  await act(async () => view.result.current.onKeep());
  expect(recovery.write).toHaveBeenCalledWith('close-test', expect.objectContaining({ payload: { text: 'latest content' } }));
  expect(mocked.close).toHaveBeenCalledOnce();
  expect(isRecoveryExit()).toBe(true);
  const reload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(reload);
  expect(reload.defaultPrevented).toBe(false);
  unregister();
});

it('does not close on a failed backup, preserves editing and allows retry', async () => {
  const draft = { key: 'note', kind: 'note' as const, ownerId: 'exit', targetId: 'n', label: '笔记', scopeKey: 'pdf:exit', payload: { markdown: 'still here' } };
  const unregister = registerSegmentEditorCloseHandler('pdf:exit', 'owner', {
    discard: vi.fn(), save: vi.fn(async () => false), isDirty: () => true,
    checkpoint: () => checkpointEditRecovery('failed-close', draft), recovery: () => ({ root: 'failed-close', key: draft.key })
  });
  recovery.write.mockRejectedValueOnce(new Error('disk full'));
  const view = renderHook(() => useUnsavedWindowCloseGuard());
  setSegmentEditorDirty('pdf:exit', 'owner', true);
  await act(async () => view.result.current.onKeep());
  expect(mocked.close).not.toHaveBeenCalled(); expect(isRecoveryExit()).toBe(false);
  expect(view.result.current.error).toContain('备份失败');
  await act(async () => view.result.current.onKeep());
  expect(mocked.close).toHaveBeenCalledOnce(); unregister();
});

it('blocks keep-and-exit for unsupported settings or an active save', async () => {
  const unregister = registerSegmentEditorCloseHandler('pdf:exit', 'owner', { discard: vi.fn(), save: vi.fn(async () => false), isDirty: () => true, isBusy: () => true });
  const view = renderHook(() => useUnsavedWindowCloseGuard());
  setSegmentEditorDirty('pdf:exit', 'owner', true);
  await act(async () => view.result.current.onKeep());
  expect(mocked.close).not.toHaveBeenCalled(); expect(view.result.current.error).toContain('请点击');
  unregister();
});

it('cleans up native subscriptions that finish after unmount', async () => {
  const view = renderHook(() => useUnsavedWindowCloseGuard());
  view.unmount();
  await act(async () => {});
  expect(mocked.unlisten).toHaveBeenCalledOnce();
});

it('stops tasks in other libraries and closes after terminal persistence settles', async () => {
  const view = renderHook(() => useUnsavedWindowCloseGuard());
  await act(async () => {});
  const controller = new AbortController();
  setAssistantBackgroundRun({ abortController: controller, root: 'other-library', question: 'Waiting for input', conversation: null,
    conversationId: 'background', error: null, noteProposalsByMessageId: {}, streamingMessageId: null, toolEventsByMessageId: {} });
  const preventDefault = vi.fn();
  mocked.listener?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(controller.signal.aborted).toBe(true);
  expect(mocked.notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: '正在结束任务' }));
  expect(mocked.close).not.toHaveBeenCalled();
  const reload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(reload);
  expect(reload.defaultPrevented).toBe(true);
  finishAssistantBackgroundRun(controller);
  await act(async () => {});
  expect(mocked.close).toHaveBeenCalledOnce();
  mocked.listener?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
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

it('drops unsent paused messages and closes without dispatching them', async () => {
  renderHook(() => useUnsavedWindowCloseGuard());
  await act(async () => {});
  const controller = new AbortController();
  setAssistantBackgroundRun({ abortController: controller, root: 'other-library', question: 'first', conversationId: 'c',
    conversation: { id: 'c', title: 'test', messages: [], scope_snapshot: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] }, created_at: '', updated_at: '' },
    error: null, noteProposalsByMessageId: {}, streamingMessageId: null, toolEventsByMessageId: {} });
  const dispatch = vi.fn();
  queueAssistantBackgroundRun(controller, { question: 'unsent' } as QueuedAssistantDraft, dispatch);
  stopAssistantBackgroundRun(controller); finishAssistantBackgroundRun(controller);
  const preventDefault = vi.fn();
  mocked.listener?.({ preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  await act(async () => {});
  expect(getAssistantMessageQueues()).toHaveLength(0);
  expect(dispatch).not.toHaveBeenCalled();
  expect(mocked.close).toHaveBeenCalledOnce();
});
