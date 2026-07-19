import type {
  AssistantContextSnapshot,
  AssistantToolTraceEvent
} from '@/shared/ipc/assistantApi';
import type {
  AssistantAgentRun,
  AssistantAgentRunNode,
  AssistantAgentRunNodeKind,
  AssistantTaskState
} from '@/shared/types/assistant';

export function emitHarnessEvent(
  onToolEvent: ((event: AssistantToolTraceEvent) => void) | undefined,
  event: AssistantToolTraceEvent
) {
  onToolEvent?.(event);
}

export class AssistantHarnessError extends Error {
  constructor(
    message: string,
    readonly agentRun: AssistantAgentRun,
    readonly cause?: unknown,
    readonly taskState?: AssistantTaskState
  ) {
    super(message);
    this.name = 'AssistantHarnessError';
  }
}

export function createAgentRun(runId: string): AssistantAgentRun {
  return {
    id: runId,
    nodes: [],
    startedAt: new Date().toISOString(),
    status: 'running',
    subagentTaskCount: 0,
    verifierErrors: 0,
    verifierWarnings: 0
  };
}

export function upsertRunNode(
  run: AssistantAgentRun,
  patch: Omit<Partial<AssistantAgentRunNode>, 'id' | 'kind' | 'title'> & {
    id: string;
    kind: AssistantAgentRunNodeKind;
    title: string;
  }
) {
  const now = new Date().toISOString();
  const existing = run.nodes.find((node) => node.id === patch.id);
  if (!existing) {
    run.nodes.push({
      ...patch,
      id: patch.id,
      kind: patch.kind,
      startedAt: now,
      status: patch.status ?? 'running',
      title: patch.title
    });
    return;
  }
  Object.assign(existing, patch);
  if (patch.status === 'succeeded' || patch.status === 'failed' || patch.status === 'skipped') {
    existing.endedAt = existing.endedAt ?? now;
    existing.durationMs = durationMs(existing.startedAt, existing.endedAt);
  }
}

export function markRunningNodesFailed(run: AssistantAgentRun, error: string) {
  markRunningNodes(run, 'failed', error);
}

export function markRunningNodesCanceled(run: AssistantAgentRun, error: string) {
  markRunningNodes(run, 'canceled', error);
}

export function markRunningNodesAwaitingUser(run: AssistantAgentRun, question: string) {
  for (const node of run.nodes) {
    if (node.status !== 'running' && node.status !== 'pending') continue;
    upsertRunNode(run, {
      id: node.id,
      kind: node.kind,
      outputSummary: question,
      status: 'skipped',
      title: node.title
    });
  }
}

export function finishAgentRun(run: AssistantAgentRun, status: AssistantAgentRun['status']) {
  const endedAt = new Date().toISOString();
  run.status = status;
  run.endedAt = endedAt;
  run.durationMs = durationMs(run.startedAt, endedAt);
  return run;
}

export function throwIfAborted(abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) {
    throw new DOMException('Agent run canceled by user.', 'AbortError');
  }
}

export function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error && /aborted|canceled|cancelled/i.test(error.message))
  );
}

export function hydrateSummary(snapshot: AssistantContextSnapshot) {
  const parts = [
    snapshot.active_entry ? 'selected entry metadata' : null,
    snapshot.active_note ? 'selected note' : null,
    snapshot.document ? 'selected entry markdown' : null,
    snapshot.pinned_segments.length > 0
      ? `${snapshot.pinned_segments.length} pinned segment${snapshot.pinned_segments.length === 1 ? '' : 's'}`
      : null
  ].filter((part): part is string => Boolean(part));
  const base = parts.length > 0
    ? `Hydrated ${parts.join(', ')}.`
    : 'No explicit chat context was hydrated.';
  return snapshot.warnings.length > 0
    ? `${base} ${snapshot.warnings.length} warning${snapshot.warnings.length === 1 ? '' : 's'}.`
    : base;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function markRunningNodes(
  run: AssistantAgentRun,
  status: 'canceled' | 'failed',
  error: string
) {
  for (const node of run.nodes) {
    if (node.status !== 'running' && node.status !== 'pending') continue;
    upsertRunNode(run, { error, id: node.id, kind: node.kind, status, title: node.title });
  }
}

function durationMs(startedAt: string, endedAt: string) {
  return Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
}
