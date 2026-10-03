// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { projectAssistantDockTasks, useAssistantTaskDock } from './useAssistantTaskDock';
import { finishAssistantBackgroundRun, getAssistantMessageQueues, queueAssistantBackgroundRun, setAssistantBackgroundRun,
  stopAssistantBackgroundRun, syncAssistantBackgroundRunState, type AssistantBackgroundRunSnapshot,
} from '@/modules/assistant/components/assistantBackgroundRuns';
import type { QueuedAssistantDraft } from '@/modules/assistant/components/assistantRunController';
import { subscribeAssistantConversationNavigation } from '@/modules/assistant/components/assistantConversationNavigation';
import { requestToolApproval } from '@/modules/assistant/runtime/toolApproval';

function task(id = 'conversation', root = 'A'): AssistantBackgroundRunSnapshot {
  return { root, conversationId: id, question: '整理研究问题', error: null, abortController: new AbortController(),
    conversation: { id, title: '阅读笔记', messages: [], scope_snapshot: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] }, created_at: '', updated_at: '' },
    streamingMessageId: 'reply', toolEventsByMessageId: {}, noteProposalsByMessageId: {} };
}
afterEach(() => { cleanup(); setAssistantBackgroundRun(null); });

it('combines a running conversation and its pending count without counting imports or another workspace', () => {
  const run = task(); setAssistantBackgroundRun(run);
  queueAssistantBackgroundRun(run.abortController, { question: '待发' } as QueuedAssistantDraft, vi.fn());
  const tasks = projectAssistantDockTasks('A', [run, task('other', 'B'), { ...task('import'), taskKind: 'paper-import' }], getAssistantMessageQueues(), [], []);
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ title: '阅读笔记', status: 'running', queuedCount: 1, canOpen: true, canStop: true });
  expect(projectAssistantDockTasks('A', [run], [], [{ root: 'A', conversationId: run.conversationId! }], [])[0])
    .toMatchObject({ status: 'waiting', detail: '等待操作确认' });
  expect(projectAssistantDockTasks('A', [run], [], [], [{ root: 'A', conversationId: run.conversationId! }])[0])
    .toMatchObject({ status: 'waiting', detail: '等待你的选择' });
});

it('does not rerender the App projection for token changes and returns/stops only the targeted conversation', () => {
  const run = task(), other = task('other'); setAssistantBackgroundRun(run); setAssistantBackgroundRun(other);
  const show = vi.fn(), navigated = vi.fn();
  const unsubscribe = subscribeAssistantConversationNavigation('A', navigated);
  let renders = 0;
  const view = renderHook(() => { renders++; return useAssistantTaskDock('A', show); });
  const id = view.result.current.tasks[0].id;
  const baseline = renders;
  act(() => syncAssistantBackgroundRunState({ abortController: run.abortController, conversation: { ...run.conversation!, messages: [] } }));
  expect(renders).toBe(baseline);
  act(() => view.result.current.openTask(id));
  expect(show).toHaveBeenCalledOnce();
  expect(navigated).toHaveBeenCalledWith({ root: 'A', conversationId: 'conversation' });
  act(() => view.result.current.stopTask(id));
  expect(run.abortController.signal.aborted).toBe(true);
  expect(other.abortController.signal.aborted).toBe(false);
  expect(view.result.current.tasks[0]).toMatchObject({ id, status: 'stopping', canStop: false });
  act(() => finishAssistantBackgroundRun(run.abortController));
  expect(view.result.current.tasks).toHaveLength(1);
  unsubscribe();
});

it('retains stopped queues after execution settles and routes them back to their original conversation', () => {
  const run = task(); setAssistantBackgroundRun(run);
  queueAssistantBackgroundRun(run.abortController, { question: '尚未发送' } as QueuedAssistantDraft, vi.fn());
  const view = renderHook(() => useAssistantTaskDock('A', vi.fn()));
  act(() => { stopAssistantBackgroundRun(run.abortController); finishAssistantBackgroundRun(run.abortController); });
  expect(view.result.current.tasks).toHaveLength(1);
  expect(view.result.current.tasks[0]).toMatchObject({ status: 'paused', queuedCount: 1, canStop: false, canOpen: true, question: '尚未发送' });
  const navigate = vi.fn();
  const unsubscribe = subscribeAssistantConversationNavigation('A', navigate);
  act(() => view.result.current.openTask(view.result.current.tasks[0].id));
  expect(navigate).toHaveBeenCalledWith({ root: 'A', conversationId: 'conversation' });
  unsubscribe();
});

it('observes waiting approvals without a run update and releases the subscription on unmount', async () => {
  const run = task(); setAssistantBackgroundRun(run);
  let renders = 0;
  const view = renderHook(() => { renders++; return useAssistantTaskDock('A', vi.fn()); });
  const abort = new AbortController();
  let pending!: Promise<unknown>;
  act(() => { pending = requestToolApproval('A', 'conversation')({ toolCallId: 'tool', toolName: 'import_papers', input: {} }, abort.signal).catch(() => undefined); });
  expect(view.result.current.tasks[0].status).toBe('waiting');
  view.unmount();
  const count = renders;
  await act(async () => { abort.abort(); await pending; });
  expect(renders).toBe(count);
});

it('does not display another workspace or allow stale actions after switching roots', () => {
  const run = task(); setAssistantBackgroundRun(run);
  const show = vi.fn();
  const view = renderHook(({ root }) => useAssistantTaskDock(root, show), { initialProps: { root: 'A' as string | null } });
  const old = view.result.current;
  const id = old.tasks[0].id;
  view.rerender({ root: 'B' });
  expect(view.result.current.tasks).toEqual([]);
  act(() => { old.openTask(id); old.stopTask(id); });
  expect(show).not.toHaveBeenCalled();
  expect(run.abortController.signal.aborted).toBe(false);
  view.rerender({ root: null });
  expect(view.result.current.tasks).toEqual([]);
});
