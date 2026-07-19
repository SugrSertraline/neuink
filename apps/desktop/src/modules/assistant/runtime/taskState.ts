import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import type {
  AssistantTaskPhase,
  AssistantTaskPlan,
  AssistantTaskState,
  AssistantTaskStatus
} from '@/shared/types/assistant';

export function latestAwaitingUserTask(history: ConversationMessage[]) {
  return tasksFromHistory(history)
    .filter((task) => task.status === 'awaiting_user')[0] ?? null;
}

export function latestPendingTask(history: ConversationMessage[], _question: string) {
  const tasks = tasksFromHistory(history);
  const awaiting = tasks.find((task) => task.status === 'awaiting_user');
  if (awaiting) return awaiting;
  // Natural-language continuation is interpreted by the Agent policy. The kernel only
  // exposes the latest resumable state; it does not require magic retry phrases.
  return tasks.find((task) => task.status === 'failed') ?? null;
}

function tasksFromHistory(history: ConversationMessage[]) {
  return history
    .flatMap((message) => message.parts ?? [])
    .filter((part): part is Extract<typeof part, { type: 'task-state' }> =>
      part.type === 'task-state'
    )
    .map((part) => part.task)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function createCompiledTaskState({
  conversationId,
  previous,
  request,
  spec
}: {
  conversationId: string;
  previous?: AssistantTaskState | null;
  request: string;
  spec: AssistantTaskPlan;
}): AssistantTaskState {
  const now = new Date().toISOString();
  const taskId = previous?.taskId ?? createId('task');
  return {
    conversationId,
    createdAt: previous?.createdAt ?? now,
    evidenceLedger: previous?.evidenceLedger ?? {
      createdAt: now,
      evidence: [],
      ledgerId: createId('ledger'),
      taskId,
      updatedAt: now
    },
    goal: {
      normalizedGoal: spec.request ?? request,
      originalRequest: previous?.goal.originalRequest ?? request
    },
    operation: spec.noteAction ?? null,
    phase: spec.missing.length > 0 ? 'compile' : 'collect_evidence',
    proposalIds: previous?.proposalIds ?? [],
    revision: (previous?.revision ?? 0) + 1,
    spec,
    status: spec.missing.length > 0 ? 'awaiting_user' : 'running',
    taskId,
    updatedAt: now
  };
}

export function transitionTaskState(
  task: AssistantTaskState,
  status: AssistantTaskStatus,
  phase: AssistantTaskPhase,
  proposalIds = task.proposalIds
) {
  return {
    ...task,
    phase,
    proposalIds,
    revision: task.revision + 1,
    status,
    updatedAt: new Date().toISOString()
  };
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
