import type { AssistantToolTraceEvent, Conversation } from '@/shared/ipc/assistantApi';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import type { QueuedAssistantDraft } from './assistantRunController';

export type AssistantBackgroundRunSnapshot = {
  abortController: AbortController;
  conversation: Conversation | null;
  conversationId: string | null;
  error: string | null;
  noteProposalsByMessageId: Record<string, AssistantNoteProposal[]>;
  question: string;
  root: string;
  streamingMessageId: string | null;
  toolEventsByMessageId: Record<string, AssistantToolTraceEvent[]>;
  queuedDraft?: QueuedAssistantDraft;
};

// Window-owned tasks outlive the selected conversation and the mounted panel.
// Controller identity also isolates tasks whose conversation is still being created.
const runs = new Map<AbortController, AssistantBackgroundRunSnapshot>();
const continuations = new Map<AbortController, (conversation: Conversation) => void>();
const listeners = new Set<(finished?: AssistantBackgroundRunSnapshot) => void>();
const emit = (finished?: AssistantBackgroundRunSnapshot) => { for (const listener of listeners) listener(finished); };

export function getAssistantBackgroundRuns(root?: string) {
  return [...runs.values()].filter(run => root === undefined || run.root === root);
}

export function getAssistantBackgroundRun(controller?: AbortController) {
  return controller ? runs.get(controller) ?? null : [...runs.values()][0] ?? null;
}

export function findAssistantBackgroundRun(root: string, conversationId: string) {
  return getAssistantBackgroundRuns(root).find(run => run.conversationId === conversationId) ?? null;
}

export function setAssistantBackgroundRun(run: AssistantBackgroundRunSnapshot | null) {
  if (run) runs.set(run.abortController, run);
  else { runs.clear(); continuations.clear(); }
  emit();
}

export function finishAssistantBackgroundRun(controller: AbortController) {
  const finished = runs.get(controller);
  const next = continuations.get(controller);
  continuations.delete(controller);
  runs.delete(controller);
  emit(finished);
  // Schedule after the old runner's finally block, so it cannot clear the new busy state.
  if (next && finished?.conversation && !finished.error && !controller.signal.aborted) {
    queueMicrotask(() => next(finished.conversation!));
  }
}

export function queueAssistantBackgroundRun(controller: AbortController, draft: QueuedAssistantDraft,
  next: (conversation: Conversation) => void) {
  const current = runs.get(controller);
  if (!current || current.queuedDraft || controller.signal.aborted) return false;
  runs.set(controller, { ...current, queuedDraft: draft });
  continuations.set(controller, next);
  emit();
  return true;
}

export function stopAssistantBackgroundRun(controller: AbortController) {
  continuations.delete(controller);
  const current = runs.get(controller);
  if (current) runs.set(controller, { ...current, queuedDraft: undefined });
  controller.abort();
  emit();
}

export function subscribeAssistantBackgroundRun(listener: (finished?: AssistantBackgroundRunSnapshot) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function syncAssistantBackgroundRunState({ abortController, ...patch }: {
  abortController: AbortController;
} & Partial<Omit<AssistantBackgroundRunSnapshot, 'abortController' | 'root' | 'question'>>) {
  const current = runs.get(abortController);
  if (!current) return;
  runs.set(abortController, {
    ...current, ...patch,
    conversationId: patch.conversation?.id ?? current.conversationId,
  });
  emit();
}

/** Async view callbacks must never publish into a different conversation or an unmounted view. */
export function guardAssistantView<Args extends unknown[]>(isCurrent: () => boolean, callback: (...args: Args) => void) {
  return (...args: Args) => { if (isCurrent()) callback(...args); };
}
