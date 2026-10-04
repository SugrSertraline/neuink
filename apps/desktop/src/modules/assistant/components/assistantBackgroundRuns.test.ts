import { afterEach, expect, it, vi } from 'vitest';
import { beginEditAssistantQueuedMessage, cancelAssistantQueuedMessage, cancelEditAssistantQueuedMessage, getAssistantMessageQueues,
  resumeAssistantMessageQueue, saveAssistantQueuedMessage, updateAssistantQueuedMessageEdit,
  syncAssistantMessageQueueConversation,
  findAssistantBackgroundRun, finishAssistantBackgroundRun, getAssistantBackgroundRuns, queueAssistantBackgroundRun,
  setAssistantBackgroundRun, stopAssistantBackgroundRun, subscribeAssistantBackgroundRun, syncAssistantBackgroundRunState,
  type AssistantBackgroundRunSnapshot } from './assistantBackgroundRuns';
import type { QueuedAssistantDraft } from './assistantRunController';

afterEach(() => setAssistantBackgroundRun(null));
function task(root = 'workspace-A'): AssistantBackgroundRunSnapshot {
  return { root, conversationId: 'same-id', question: 'test', error: null, abortController: new AbortController(),
    conversation: { id: 'same-id', title: 'test', messages: [], scope_snapshot: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] }, created_at: '', updated_at: '' },
    streamingMessageId: 'reply', toolEventsByMessageId: {}, noteProposalsByMessageId: {} };
}

it('isolates matching conversation ids in different workspaces and ignores finished writers', () => {
  const a = task(), b = task('workspace-B');
  setAssistantBackgroundRun(a); setAssistantBackgroundRun(b);
  expect(findAssistantBackgroundRun('workspace-B', 'same-id')).toBe(b);
  expect(getAssistantBackgroundRuns('workspace-A')).toEqual([a]);
  finishAssistantBackgroundRun(a.abortController);
  syncAssistantBackgroundRunState({ abortController: a.abortController, error: 'late' });
  expect(getAssistantBackgroundRuns()).toEqual([b]);
});

it('keeps execution alive without a view subscriber and delivers its last snapshot on completion', () => {
  const run = task(); setAssistantBackgroundRun(run);
  const oldView = vi.fn(); const leave = subscribeAssistantBackgroundRun(oldView); leave();
  syncAssistantBackgroundRunState({ abortController: run.abortController, error: 'background failure' });
  expect(oldView).not.toHaveBeenCalled();
  const newView = vi.fn(); const close = subscribeAssistantBackgroundRun(newView);
  finishAssistantBackgroundRun(run.abortController);
  expect(newView).toHaveBeenLastCalledWith(expect.objectContaining({ error: 'background failure' }));
  expect(run.abortController.signal.aborted).toBe(false);
  close();
});

it('continues a queued request with the final conversation even when no view is attached', async () => {
  const run = task(); setAssistantBackgroundRun(run);
  const next = vi.fn();
  const draft = { question: 'follow-up' } as QueuedAssistantDraft;
  expect(queueAssistantBackgroundRun(run.abortController, draft, next)).toBe(true);
  expect(queueAssistantBackgroundRun(run.abortController, draft, next)).toBe(true);
  const finalConversation = { ...run.conversation!, title: 'final state' };
  syncAssistantBackgroundRunState({ abortController: run.abortController, conversation: finalConversation });
  finishAssistantBackgroundRun(run.abortController);
  expect(next).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(next).toHaveBeenCalledExactlyOnceWith(finalConversation, draft);
});

it.each(['stop', 'failure'])('does not start queued requests after %s', async reason => {
  const run = task(); setAssistantBackgroundRun(run);
  const next = vi.fn();
  queueAssistantBackgroundRun(run.abortController, { question: 'follow-up' } as QueuedAssistantDraft, next);
  if (reason === 'stop') stopAssistantBackgroundRun(run.abortController);
  else syncAssistantBackgroundRunState({ abortController: run.abortController, error: 'failed' });
  finishAssistantBackgroundRun(run.abortController);
  await Promise.resolve();
  expect(next).not.toHaveBeenCalled();
  expect(getAssistantMessageQueues()[0]).toMatchObject({ paused: true, pauseReason: reason === 'stop' ? 'stopped' : 'failed' });
  expect(getAssistantMessageQueues()[0].items).toHaveLength(1);
});

function draft(question: string): QueuedAssistantDraft {
  return { question, snapshot: { text: question, mentions: [] }, contextItems: [], contextPlan: null,
    activeEntry: null, activeNote: null, activeSegment: null,
    activeSurface: { kind: 'library', capturedAt: '', entryId: null, noteId: null, pane: 'left', segmentUid: null, surfaceKey: 'library' },
    scope: { entry_ids: [], entry_titles: [], tag_ids: [], tag_names: [] } };
}

it('drains multiple requests FIFO across controller handoffs with no mounted subscriber', async () => {
  const initial = task(); setAssistantBackgroundRun(initial);
  const started: AssistantBackgroundRunSnapshot[] = [];
  const execute = vi.fn((conversation, submitted) => {
    const run = { ...task(), conversation, question: submitted.question };
    started.push(run); setAssistantBackgroundRun(run);
  });
  for (const question of ['second', 'third', 'fourth']) queueAssistantBackgroundRun(initial.abortController, draft(question), execute);
  const queueId = getAssistantMessageQueues()[0].id;
  finishAssistantBackgroundRun(initial.abortController);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  expect(getAssistantMessageQueues()[0].id).toBe(queueId);
  expect(getAssistantMessageQueues()[0].items.map(item => item.draft.question)).toEqual(['third', 'fourth']);
  finishAssistantBackgroundRun(started[0].abortController);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  finishAssistantBackgroundRun(started[1].abortController);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3));
  finishAssistantBackgroundRun(started[2].abortController);
  await vi.waitFor(() => expect(getAssistantMessageQueues()).toHaveLength(0));
  expect(execute.mock.calls.map(([, submitted]) => submitted.question)).toEqual(['second', 'third', 'fourth']);
});

it('locks the editing head through completion, saves frozen scope and starts the edited text exactly once', async () => {
  const initial = task(); setAssistantBackgroundRun(initial);
  const execute = vi.fn((conversation, submitted) => setAssistantBackgroundRun({ ...task(), conversation, question: submitted.question }));
  const frozen = draft('original'); frozen.activeEntry = { id: 'A', title: 'Paper A' };
  queueAssistantBackgroundRun(initial.abortController, frozen, execute);
  queueAssistantBackgroundRun(initial.abortController, draft('later'), execute);
  const queue = getAssistantMessageQueues()[0], id = queue.items[0].id;
  expect(beginEditAssistantQueuedMessage(queue.id, id)).toBe(true);
  updateAssistantQueuedMessageEdit(queue.id, id, 'edited');
  finishAssistantBackgroundRun(initial.abortController);
  await Promise.resolve();
  expect(execute).not.toHaveBeenCalled();
  expect(getAssistantMessageQueues()[0].items[0]).toMatchObject({ editing: true, editText: 'edited' });
  expect(saveAssistantQueuedMessage(queue.id, id, '  ')).toBe(false);
  expect(saveAssistantQueuedMessage(queue.id, id, 'edited')).toBe(true);
  expect(saveAssistantQueuedMessage(queue.id, id, 'duplicate')).toBe(false);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  expect(execute.mock.calls[0][1]).toMatchObject({ question: 'edited', snapshot: { text: 'edited' }, activeEntry: { id: 'A' } });
  expect(cancelAssistantQueuedMessage(queue.id, id)).toBe(false);
});

it('cancels unsent messages without aborting the active request or changing other workspaces', async () => {
  const a = task(), b = task('workspace-B'); setAssistantBackgroundRun(a); setAssistantBackgroundRun(b);
  const next = vi.fn();
  queueAssistantBackgroundRun(a.abortController, draft('A1'), next);
  queueAssistantBackgroundRun(a.abortController, draft('A2'), next);
  queueAssistantBackgroundRun(b.abortController, draft('B1'), next);
  const qa = getAssistantMessageQueues('workspace-A')[0];
  beginEditAssistantQueuedMessage(qa.id, qa.items[0].id);
  cancelEditAssistantQueuedMessage(qa.id, qa.items[0].id);
  cancelAssistantQueuedMessage(qa.id, qa.items[0].id);
  expect(a.abortController.signal.aborted).toBe(false);
  expect(getAssistantMessageQueues('workspace-A')[0].items.map(item => item.draft.question)).toEqual(['A2']);
  expect(getAssistantMessageQueues('workspace-B')[0].items.map(item => item.draft.question)).toEqual(['B1']);
});

it('retains a failed queue until explicit resume and consumes the latest conversation once', async () => {
  const initial = task(); setAssistantBackgroundRun(initial);
  const execute = vi.fn((conversation, submitted) => setAssistantBackgroundRun({ ...task(), conversation, question: submitted.question }));
  queueAssistantBackgroundRun(initial.abortController, draft('second'), execute);
  syncAssistantBackgroundRunState({ abortController: initial.abortController, error: 'failed' });
  finishAssistantBackgroundRun(initial.abortController);
  await Promise.resolve();
  expect(execute).not.toHaveBeenCalled();
  const queue = getAssistantMessageQueues()[0];
  expect(resumeAssistantMessageQueue(queue.id)).toBe(true);
  expect(resumeAssistantMessageQueue(queue.id)).toBe(false);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
});

it('preserves a request whose execution callback cannot start a new writer, without retrying endlessly', async () => {
  const initial = task(); setAssistantBackgroundRun(initial);
  const execute = vi.fn(() => { throw new Error('unavailable'); });
  queueAssistantBackgroundRun(initial.abortController, draft('second'), execute);
  finishAssistantBackgroundRun(initial.abortController);
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  expect(getAssistantMessageQueues()[0].items[0].draft.question).toBe('second');
  expect(getAssistantMessageQueues()[0].paused).toBe(true);
});

it('uses saved review decisions for an edited queue without mixing matching conversation ids across workspaces', async () => {
  const a = task(), b = task('workspace-B'); setAssistantBackgroundRun(a); setAssistantBackgroundRun(b);
  const execute = vi.fn((conversation, submitted) => setAssistantBackgroundRun({ ...task(), conversation, question: submitted.question }));
  queueAssistantBackgroundRun(a.abortController, draft('A next'), execute);
  queueAssistantBackgroundRun(b.abortController, draft('B next'), vi.fn());
  const queue = getAssistantMessageQueues('workspace-A')[0];
  beginEditAssistantQueuedMessage(queue.id, queue.items[0].id);
  finishAssistantBackgroundRun(a.abortController);
  const saved = { ...a.conversation!, title: 'decision saved', messages: [{ message_id: 'saved', role: 'assistant' as const,
    content: 'User has rejected the change', source_links: [], created_at: '' }] };
  syncAssistantMessageQueueConversation('workspace-A', saved);
  expect(getAssistantMessageQueues('workspace-B')[0].conversationTitle).toBe('test');
  saveAssistantQueuedMessage(queue.id, queue.items[0].id, 'A next');
  await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
  expect(execute.mock.calls[0][0]).toEqual(saved);
});

it('editing question text retains the frozen mention attachments and reading scope', () => {
  const initial = task(); setAssistantBackgroundRun(initial);
  const original = draft('Read @Paper A');
  original.snapshot.mentions = [{ id: 'entry:A', label: 'Paper A', kind: 'entry', role: 'read', entryId: 'A',
    entryTitle: 'Paper A', charOffset: 5, marker: '@Paper A' }];
  original.contextItems = [{ id: 'entry:A', entryId: 'A', entryTitle: 'Paper A', kind: 'entry', addedAt: '' }];
  original.scope.entry_ids = ['A'];
  queueAssistantBackgroundRun(initial.abortController, original, vi.fn());
  const queue = getAssistantMessageQueues()[0], item = queue.items[0];
  beginEditAssistantQueuedMessage(queue.id, item.id);
  saveAssistantQueuedMessage(queue.id, item.id, 'Compare the methodology');
  const updated = getAssistantMessageQueues()[0].items[0].draft;
  expect(updated.question).toBe('Compare the methodology');
  expect(updated.snapshot.mentions).toEqual(original.snapshot.mentions);
  expect(updated.contextItems).toEqual(original.contextItems);
  expect(updated.scope).toEqual(original.scope);
});
