import type { AssistantToolTraceEvent, Conversation } from '@/shared/ipc/assistantApi';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import type { QueuedAssistantDraft } from './assistantRunController';
import { planAssistantContext } from '../harness/contextPlanner';

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
  startedAt?: number;
  taskKind?: 'conversation' | 'paper-import';
};

export type AssistantQueuedMessage = { id: string; draft: QueuedAssistantDraft; editing: boolean; editText?: string };
export type AssistantMessageQueueSnapshot = {
  id: string;
  root: string;
  conversationId: string | null;
  conversationTitle: string;
  items: AssistantQueuedMessage[];
  paused: boolean;
  pauseReason: 'stopped' | 'failed' | 'unavailable' | null;
};
type QueueItem = AssistantQueuedMessage & {
  execute: (conversation: Conversation, draft: QueuedAssistantDraft) => Promise<void> | void;
};
type MessageQueue = Omit<AssistantMessageQueueSnapshot, 'items'> & {
  items: QueueItem[];
  conversation: Conversation | null;
  controller: AbortController | null;
  dispatching: boolean;
};

// Window-owned tasks outlive the selected conversation and the mounted panel.
// Controller identity also isolates tasks whose conversation is still being created.
const runs = new Map<AbortController, AssistantBackgroundRunSnapshot>();
const queues = new Map<string, MessageQueue>();
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
  if (run) {
    runs.set(run.abortController, run);
    const queue = [...queues.values()].find(item => item.root === run.root &&
      item.conversationId !== null && item.conversationId === run.conversationId);
    if (queue) { queue.controller = run.abortController; queue.conversation = run.conversation; }
  } else { runs.clear(); queues.clear(); }
  emit();
}

export function finishAssistantBackgroundRun(controller: AbortController) {
  const finished = runs.get(controller);
  const queue = [...queues.values()].find(item => item.controller === controller);
  if (queue) {
    queue.controller = null;
    queue.conversation = finished?.conversation ?? queue.conversation;
    if (controller.signal.aborted || finished?.error || !queue.conversation) {
      queue.paused = true;
      queue.pauseReason = controller.signal.aborted ? 'stopped' : finished?.error ? 'failed' : 'unavailable';
    }
  }
  runs.delete(controller);
  emit(finished);
  // The old runner must finish its finally block before the next writer starts.
  if (queue) queueMicrotask(() => drainQueue(queue));
}

export function queueAssistantBackgroundRun(controller: AbortController, draft: QueuedAssistantDraft,
  next: QueueItem['execute']) {
  const current = runs.get(controller);
  if (!current?.conversationId || controller.signal.aborted || current.taskKind === 'paper-import') return false;
  let queue = [...queues.values()].find(item => item.controller === controller);
  if (!queue) {
    queue = { id: crypto.randomUUID(), root: current.root, conversationId: current.conversationId,
      conversationTitle: current.conversation?.title ?? current.question, conversation: current.conversation,
      controller, dispatching: false, items: [], paused: false, pauseReason: null };
    queues.set(queue.id, queue);
  }
  queue.items.push({ id: crypto.randomUUID(), draft: structuredClone(draft), execute: next, editing: false });
  emit();
  return true;
}

export function stopAssistantBackgroundRun(controller: AbortController) {
  const queue = [...queues.values()].find(item => item.controller === controller);
  if (queue) { queue.paused = true; queue.pauseReason = 'stopped'; }
  controller.abort();
  emit();
}

/** Snapshots omit execution callbacks; unsent messages never become conversation history. */
export function getAssistantMessageQueues(root?: string): AssistantMessageQueueSnapshot[] {
  return [...queues.values()].filter(queue => (root === undefined || queue.root === root) && queue.items.length > 0)
    .map(({ id, root, conversationId, conversationTitle, items, paused, pauseReason }) => ({
      id, root, conversationId, conversationTitle, paused, pauseReason,
      items: items.map(({ id, draft, editing, editText }) => ({ id, draft, editing, editText })),
    }));
}

/** Review decisions can change persisted history while an unsent queue is paused or being edited.
 * Only saved/read-back conversations belong here; a running writer owns its own snapshots. */
export function syncAssistantMessageQueueConversation(root: string, conversation: Conversation) {
  const queue = [...queues.values()].find(queue => queue.root === root && queue.conversationId === conversation.id);
  if (!queue || queue.controller) return;
  queue.conversation = conversation;
  queue.conversationTitle = conversation.title;
  emit();
}

function drainQueue(queue: MessageQueue) {
  if (queues.get(queue.id) !== queue || queue.controller || queue.dispatching) return;
  if (!queue.items.length) { queues.delete(queue.id); emit(); return; }
  if (queue.paused || queue.items[0].editing || !queue.conversation) return;
  const item = queue.items.shift()!;
  queue.dispatching = true;
  emit();
  // Invoke synchronously to reserve the new writer before another submit can run.
  let execution: Promise<void> | void;
  try { execution = item.execute(queue.conversation, structuredClone(item.draft)); }
  catch { execution = Promise.reject(new Error('queued run unavailable')); }
  if (!queue.controller) {
    queue.items.unshift(item);
    queue.paused = true;
    queue.pauseReason = 'unavailable';
  }
  void Promise.resolve(execution).catch(() => {
    queue.paused = true;
    queue.pauseReason = 'failed';
  }).finally(() => {
    if (queues.get(queue.id) !== queue) return;
    queue.dispatching = false;
    emit();
    drainQueue(queue);
  });
}

export function beginEditAssistantQueuedMessage(queueId: string, messageId: string) {
  const item = queues.get(queueId)?.items.find(item => item.id === messageId);
  if (!item || item.editing) return false;
  item.editing = true;
  item.editText = item.draft.question;
  emit();
  return true;
}

export function updateAssistantQueuedMessageEdit(queueId: string, messageId: string, text: string) {
  const item = queues.get(queueId)?.items.find(item => item.id === messageId);
  if (!item?.editing) return;
  item.editText = text;
  emit();
}

export function saveAssistantQueuedMessage(queueId: string, messageId: string, question: string) {
  const queue = queues.get(queueId);
  const item = queue?.items.find(item => item.id === messageId);
  if (!queue || !item?.editing || !question.trim()) return false;
  const snapshot = { ...item.draft.snapshot, text: question.trim() };
  item.draft = { ...item.draft, question: question.trim(), snapshot,
    contextPlan: planAssistantContext({ composerSnapshot: snapshot, items: item.draft.contextItems, question: question.trim() }) };
  item.editing = false;
  item.editText = undefined;
  emit();
  queueMicrotask(() => drainQueue(queue));
  return true;
}

export function cancelEditAssistantQueuedMessage(queueId: string, messageId: string) {
  const queue = queues.get(queueId);
  const item = queue?.items.find(item => item.id === messageId);
  if (!queue || !item?.editing) return;
  item.editing = false;
  item.editText = undefined;
  emit();
  queueMicrotask(() => drainQueue(queue));
}

export function cancelAssistantQueuedMessage(queueId: string, messageId: string) {
  const queue = queues.get(queueId);
  if (!queue) return false;
  const index = queue.items.findIndex(item => item.id === messageId);
  if (index < 0) return false;
  queue.items.splice(index, 1);
  emit();
  queueMicrotask(() => drainQueue(queue));
  return true;
}

export function resumeAssistantMessageQueue(queueId: string) {
  const queue = queues.get(queueId);
  if (!queue?.paused || queue.controller || queue.dispatching || !queue.conversation || !queue.items.length) return false;
  queue.paused = false;
  queue.pauseReason = null;
  emit();
  queueMicrotask(() => drainQueue(queue));
  return true;
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
  const queue = [...queues.values()].find(item => item.controller === abortController);
  if (queue && patch.conversation) {
    queue.conversation = patch.conversation;
    queue.conversationId = patch.conversation.id;
    queue.conversationTitle = patch.conversation.title;
  }
  emit();
}

/** Async view callbacks must never publish into a different conversation or an unmounted view. */
export function guardAssistantView<Args extends unknown[]>(isCurrent: () => boolean, callback: (...args: Args) => void) {
  return (...args: Args) => { if (isCurrent()) callback(...args); };
}
