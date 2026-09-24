import { afterEach, expect, it, vi } from 'vitest';
import { findAssistantBackgroundRun, finishAssistantBackgroundRun, getAssistantBackgroundRuns, queueAssistantBackgroundRun,
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
  expect(queueAssistantBackgroundRun(run.abortController, draft, next)).toBe(false);
  const finalConversation = { ...run.conversation!, title: 'final state' };
  syncAssistantBackgroundRunState({ abortController: run.abortController, conversation: finalConversation });
  finishAssistantBackgroundRun(run.abortController);
  expect(next).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(next).toHaveBeenCalledExactlyOnceWith(finalConversation);
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
});
