import type { ApplicationActions } from '../runtime/applicationActions';
import type { RequestToolApproval } from '../runtime/toolApproval';
import type { RequestUserInput } from '../runtime/userInput';
import { runDurableHarness } from './durableHarness';
import type { DurableExecution } from '../runtime/durableExecution';
import type { RunBudget } from '../agent-core';
import { resolveModelProfile } from '../sdk/modelTasks';
import type {
  AssistantContextSnapshot,
  AssistantToolTraceEvent,
  ConversationMessage,
  LlmProfile,
  ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import {
  getAssistantContextSnapshot,
  loadAgentRuntimeSettings
} from '@/shared/ipc/assistantApi';
import type {
  AssistantActiveNote,
  AssistantActiveSegment,
  AssistantActiveSurfaceSnapshot,
  AssistantAgentRun,
  AssistantContext,
  AssistantContextPlan,
  AssistantComposerSnapshot,
  AssistantEntryMetaTarget,
  AssistantNoteProposal,
  AssistantTaskPlan,
  AssistantTaskState
} from '@/shared/types/assistant';
import {
  normalizeAgentRuntimeSettings,
  readAgentRuntimeSettings,
  selectAgentExecution
} from '@/shared/lib/agentRuntimeSettings';

import { answerWithGroundedAgent, type GroundedAnswer } from '../sdk/qna';
import { registerEvidence } from '../runtime/evidenceLedger';
import { createCompiledTaskState, transitionTaskState } from '../runtime/taskState';
import { finalizeVerifiedProposals } from '../runtime/verifiedProposal';
import { AssistantVerificationError } from './verification';
import { verifyHarnessResult } from './verification';
import { observeAssistantContext } from './context';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { routeAssistantRequest, routeSummary, type RequestRoute } from '../runtime/requestRouter';
import { latestConversationMemory } from './conversationMemory';
import {
  AssistantHarnessError,
  createAgentRun,
  emitHarnessEvent,
  errorMessage,
  finishAgentRun,
  hydrateSummary,
  isAbortError,
  markRunningNodesCanceled,
  markRunningNodesFailed,
  throwIfAborted,
  upsertRunNode
} from './runState';

export { AssistantHarnessError } from './runState';

export type RunAssistantHarnessOptions = {
  budget?: RunBudget;
  execution?: DurableExecution;
  resumeExecutionId?: string;
  applicationActions?: ApplicationActions;
  requestToolApproval?: RequestToolApproval;
  requestUserInput?: RequestUserInput;
  abortSignal?: AbortSignal;
  availableEntries?: AssistantEntryMetaTarget[];
  availableNotes?: unknown[];
  availableTags?: unknown[];
  assistantContext?: AssistantContext | null;
  contextPlan?: AssistantContextPlan | null;
  composerSnapshot?: AssistantComposerSnapshot | null;
  conversationId?: string;
  conversationHistory?: ConversationMessage[];
  currentEntry?: { id: string; title: string } | null;
  currentNote?: AssistantActiveNote | null;
  currentSegment?: AssistantActiveSegment | null;
  currentSurface?: AssistantActiveSurfaceSnapshot | null;
  destinationEntryId?: string | null;
  mentionScope?: ScopeSnapshot | null;
  tagMentionScopes?: Record<string, ScopeSnapshot>;
  onCreateEntry?: (title: string) => Promise<AssistantEntryMetaTarget>;
  onAnswerReset?: () => void;
  onDelta?: (delta: string) => void;
  onNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onToolEvent?: (event: AssistantToolTraceEvent) => void;
  onReasoningDelta?: (delta: string) => void;
  onModelTranscript?: (transcript: import('@/shared/types/modelTranscript').AssistantModelTranscript) => void | Promise<void>;
  preferredAgentId?: string | null;
  profiles?: LlmProfile[];
  question: string;
  resumeFromNodeId?: string | null;
  resumedFromRunId?: string | null;
  /** Set by the run controller. Absent means `search_library` asks for clarification, never the legacy scope. */
  retrievalScope?: ScopeSnapshot;
  root: string;
  scope: ScopeSnapshot;
  settings: LlmProfile;
};

export async function runAssistantHarness(options: RunAssistantHarnessOptions): Promise<GroundedAnswer> {
  return runDurableHarness(options, executeAssistantHarness);
}

async function executeAssistantHarness(options: RunAssistantHarnessOptions): Promise<GroundedAnswer> {
  const {
    abortSignal,
    assistantContext,
    availableEntries = [],
    contextPlan,
    composerSnapshot,
    conversationHistory = [],
    conversationId,
    currentEntry,
    currentNote,
    currentSegment,
    currentSurface,
    mentionScope,
    tagMentionScopes,
    onCreateEntry,
    onAnswerReset,
    onDelta,
    onNoteProposal,
    onToolEvent,
    onReasoningDelta,
    preferredAgentId,
    profiles = [],
    question,
    resumeFromNodeId,
    resumedFromRunId,
    retrievalScope,
    root,
    scope,
    settings
  } = options;
  const runId = `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const agentRun = createAgentRun(runId);
  let activeTaskState: AssistantTaskState | undefined;
  if (resumedFromRunId) {
    agentRun.resumedFromRunId = resumedFromRunId;
    agentRun.resumeFromNodeId = resumeFromNodeId ?? undefined;
  }

  try {
    throwIfAborted(abortSignal);
    const observed = observeAssistantContext({
      activeSegment: currentSegment,
      activeSurface: currentSurface,
      assistantContext,
      contextPlan,
      fallbackEntryId: currentEntry?.id ?? null,
      fallbackNote: currentNote
        ? { entryId: currentNote.entryId, noteId: currentNote.noteId }
        : null
    });
    recordNode(agentRun, onToolEvent, {
      id: `${runId}-observe`,
      kind: 'observe',
      summary: `Observed ${observed.summary}.`,
      title: 'Observe explicit UI context'
    });

    const route = options.execution?.get<RequestRoute>('requestRoute') ?? await routeAssistantRequest({
      question,
      history: conversationHistory,
      legacyPlan: composerSnapshot?.executionMode === 'plan',
      hasContext: Boolean(observed.activeEntryId || observed.activeNote || observed.activeSegment ||
        currentSurface?.browserTab ||
        observed.pinnedSegments.length || assistantContext?.items.length ||
        composerSnapshot?.mentions.length || contextPlan?.items.length || contextPlan?.editTarget ||
        options.destinationEntryId || preferredAgentId),
    }, abortSignal);
    options.execution?.set('requestRoute', route);
    emitHarnessEvent(onToolEvent, {
      id: `${runId}-route`, status: 'done', toolName: 'agent.route',
      summary: routeSummary(route), input: { ...route },
    });
    const snapshot = options.execution?.get<AssistantContextSnapshot>('contextSnapshot') ??
      (route.path === 'lightweight_chat'
        ? { active_entry: null, active_note: null, document: null, pinned_segments: [], warnings: [] }
        : await getAssistantContextSnapshot({
          metadataOnly: true,
          activeEntryId: observed.activeEntryId,
          activeNote: observed.activeNote,
          pinnedSegments: observed.pinnedSegments,
          root
        }));
    options.execution?.set('contextSnapshot', snapshot);
    recordNode(agentRun, onToolEvent, {
      id: `${runId}-hydrate`,
      kind: 'hydrate',
      sourceCount: snapshot.pinned_segments.length,
      summary: hydrateSummary(snapshot),
      title: 'Hydrate explicit workspace context'
    });
    throwIfAborted(abortSignal);

    const runtimeSettings = await loadWorkspaceAgentRuntimeSettings(root);
    // Recompute grants on resume. A checkpoint never authorizes tools that have
    // since been disabled, and the frozen composer owns the per-request mode.
    const { plan, invocationPlan } = buildDirectExecution(
      runtimeSettings, question, composerSnapshot?.executionMode ?? 'act', route
    );
    activeTaskState = options.execution?.get<AssistantTaskState>('initialTaskState') ?? createCompiledTaskState({
      conversationId: conversationId ?? 'local',
      request: question,
      spec: plan
    });
    options.execution?.set('initialTaskState', activeTaskState);
    await options.execution?.flush();
    const activeExecution = selectAgentExecution(
      runtimeSettings,
      question,
      plan,
      preferredAgentId,
      invocationPlan
    );
    const executionProfile = resolveModelProfile(activeExecution.agent.llmProfileId, profiles, settings);
    agentRun.invocationMode = 'agent_execute';
    agentRun.mainAssistantId = activeExecution.agent.id;
    upsertRunNode(agentRun, {
      agentId: activeExecution.agent.id,
      id: `${runId}-loop`,
      inputSummary: `goal=${question.slice(0, 180)}`,
      kind: 'main_assistant',
      status: 'running',
      title: plan.executionMode === 'plan' ? 'Read-only planning in the main Agent' : 'Run model-driven Agent loop'
    });
    emitHarnessEvent(onToolEvent, {
      id: `${runId}-loop`,
      input: { goal: question },
      status: 'running',
      summary: 'Agent is deciding whether to answer, ask naturally, or use a tool.',
      toolName: plan.executionMode === 'plan' ? 'agent.plan' : 'agent.loop'
    });

    let streamedAnswer = false;
    abortSignal?.throwIfAborted();
    const delegatedCalls = new Set<string>();
    const grounded = await answerWithGroundedAgent({
      onModelTranscript: options.onModelTranscript,
      budget: options.budget,
      execution: options.execution,
      applicationActions: options.applicationActions,
      requestToolApproval: options.requestToolApproval,
      requestUserInput: options.requestUserInput,
      abortSignal,
      activeExecution,
      assistantContext,
      availableEntries,
      contextSnapshot: snapshot,
      browserTabTarget: currentSurface?.kind === 'browser' ? currentSurface.browserTab : null,
      conversationHistory,
      composerSnapshot,
      tagMentionScopes,
      conversationMemory: latestConversationMemory(conversationHistory),
      currentEntry: snapshot.active_entry
        ? { id: snapshot.active_entry.entry_id, title: snapshot.active_entry.entry_title }
        : currentEntry,
      currentNote: activeNote(snapshot) ?? currentNote,
      invocationPlan,
      onAnswerReset: onAnswerReset
        ? () => {
            streamedAnswer = false;
            onAnswerReset();
          }
        : undefined,
      onCreateEntry,
      onDelta: onDelta
        ? (delta) => {
            streamedAnswer = true;
            onDelta(delta);
          }
        : undefined,
      onReasoningDelta,
      onToolEvent: (event) => {
        if (event.toolName === 'task_run_subagent') {
          delegatedCalls.add(event.id);
          agentRun.subagentTaskCount = delegatedCalls.size;
          upsertRunNode(agentRun, {
            id: `${runId}-${event.id}`, kind: 'subagent', title: 'Delegated task',
            status: event.status === 'done' ? 'succeeded' : event.status === 'error' ? 'failed' : 'running',
            outputSummary: event.summary, error: event.error, sourceCount: event.sources?.length
          });
        }
        onToolEvent?.(event);
      },
      plan,
      profiles,
      question,
      retrievalScope,
      root,
      runtimeSettings,
      scope,
      settings: executionProfile
    });
    throwIfAborted(abortSignal);
    const verification = verifyHarnessResult({
      activeExecution,
      grounded,
      invocationPlan,
      plan,
      snapshot
    });
    if (verification.errors.length > 0) {
      throw new AssistantVerificationError(verification.errors);
    }
    verifyGroundedProposals({
      composerSnapshot,
      assistantContext,
      contextPlan,
      currentSurface,
      history: conversationHistory,
      proposals: grounded.noteProposals ?? [],
      sources: grounded.sources
    });

    const verifiedProposals = finalizeVerifiedProposals(
      grounded.noteProposals ?? [],
      activeTaskState.taskId
    );
    grounded.noteProposals = verifiedProposals;
    for (const proposal of verifiedProposals) onNoteProposal?.(proposal);
    const proposalIds = [
      ...verifiedProposals.map((proposal) => proposal.id),
      ...(grounded.entryMetaProposals ?? []).map((proposal) => proposal.id),
      ...(grounded.tagProposals ?? []).map((proposal) => proposal.id)
    ];
    const nextTaskState = {
      ...transitionTaskState(
        {
          ...activeTaskState,
          evidenceLedger: registerEvidence(activeTaskState.evidenceLedger, grounded.sources)
        },
        proposalIds.length > 0 ? 'awaiting_approval' : plan.executionMode === 'plan' ? 'awaiting_user' : 'completed',
        proposalIds.length > 0 ? 'propose' : 'verify',
        proposalIds
      ),
      agentLoopState: grounded.agentLoopState
    };
    activeTaskState = nextTaskState;
    upsertRunNode(agentRun, {
      agentId: activeExecution.agent.id,
      id: `${runId}-loop`,
      kind: 'main_assistant',
      outputSummary: `answer=${grounded.answer.length}, tools=${grounded.agentLoopState?.toolCallCount ?? 0}`,
      sourceCount: grounded.sources.length,
      status: 'succeeded',
      title: 'Run model-driven Agent loop'
    });
    emitHarnessEvent(onToolEvent, {
      id: `${runId}-loop`,
      status: 'done',
      summary: 'Agent reached a terminal response for this turn.',
      toolName: plan.executionMode === 'plan' ? 'agent.plan' : 'agent.loop'
    });
    if (grounded.turnDurationsMs?.length) {
      agentRun.turnDurationsMs = grounded.turnDurationsMs;
    }
    if (!streamedAnswer) onDelta?.(grounded.answer);
    return {
      ...grounded,
      agentRun: finishAgentRun(agentRun, 'succeeded'),
      // No invented workflow steps in the UI; a requested plan is the actual answer.
      taskState: nextTaskState
    };
  } catch (error) {
    const message = errorMessage(error);
    const canceled = Boolean(abortSignal?.aborted) || isAbortError(error);
    if (canceled) {
      markRunningNodesCanceled(agentRun, message);
      finishAgentRun(agentRun, 'canceled');
    } else {
      markRunningNodesFailed(agentRun, message);
      finishAgentRun(agentRun, 'failed');
    }
    const failedTask = activeTaskState
      ? transitionTaskState(
          activeTaskState,
          canceled ? 'cancelled' : 'failed',
          activeTaskState.phase
        )
      : undefined;
    throw new AssistantHarnessError(message, agentRun, error, failedTask);
  }
}

function activeNote(snapshot: AssistantContextSnapshot): AssistantActiveNote | null {
  const note = snapshot.active_note;
  return note
    ? {
        entryId: note.entry_id,
        entryTitle: note.entry_title,
        noteId: note.note_id,
        noteTitle: note.note_title
      }
    : null;
}

export function verifyGroundedProposals({
  composerSnapshot,
  assistantContext,
  contextPlan,
  currentSurface,
  history = [],
  proposals,
  sources
}: {
  composerSnapshot?: AssistantComposerSnapshot | null;
  assistantContext?: AssistantContext | null;
  contextPlan?: AssistantContextPlan | null;
  currentSurface?: AssistantActiveSurfaceSnapshot | null;
  history?: ConversationMessage[];
  proposals: AssistantNoteProposal[];
  sources: GroundedAnswer['sources'];
}) {
  const browserTarget = currentSurface?.kind === 'browser' && Boolean(currentSurface.browserTab);
  // A newly submitted webpage does not inherit evidence obligations from old paper requests.
  // Current attachments and sources acquired in this run retain their normal citation checks.
  const historicalMentions = browserTarget ? [] : history.flatMap((message) => (message.parts ?? []).flatMap((part) =>
    part.type === 'context-snapshot' ? part.composer?.mentions ?? [] : []
  ));
  const hasEvidenceReference = [
    ...(composerSnapshot?.mentions ?? []),
    ...historicalMentions
  ].some((mention) =>
    mention.kind === 'tag' || mention.kind === 'pdf' || mention.kind === 'reflow' ||
    mention.kind === 'segment' || mention.kind === 'overview' || mention.role === 'evidence'
  ) || Boolean(browserTarget && (
    assistantContext?.items.some(item => item.kind === 'segment' || (item.kind === 'entry' && ['pdf', 'reflow', 'overview'].includes(item.contentKind ?? ''))) ||
    contextPlan?.items.some(item => item.role !== 'edit_target' &&
      (['pdf', 'reflow', 'segment', 'overview'].includes(item.kind) || (item.role === 'evidence' && item.kind !== 'note')))
  ));
  if (!hasEvidenceReference && sources.length === 0) return;
  const invalid = proposals.find(
    (proposal) =>
      Boolean(proposal.markdown.trim()) &&
      proposal.sources.length === 0
  );
  if (invalid) {
    throw new AssistantVerificationError([
      'A paper-grounded note proposal was produced without a valid source citation.'
    ]);
  }
}

function recordNode(
  run: AssistantAgentRun,
  onToolEvent: ((event: AssistantToolTraceEvent) => void) | undefined,
  event: {
    id: string;
    kind: 'hydrate' | 'observe' | 'planner';
    sourceCount?: number;
    summary: string;
    title: string;
  }
) {
  emitHarnessEvent(onToolEvent, {
    id: event.id,
    status: 'done',
    summary: event.summary,
    toolName: `agent.${event.kind}`
  });
  upsertRunNode(run, {
    id: event.id,
    kind: event.kind,
    outputSummary: event.summary,
    sourceCount: event.sourceCount,
    status: 'succeeded',
    title: event.title
  });
}

async function loadWorkspaceAgentRuntimeSettings(root: string) {
  try {
    const workspaceSettings = await loadAgentRuntimeSettings(root);
    return normalizeAgentRuntimeSettings(workspaceSettings ?? readAgentRuntimeSettings());
  } catch {
    // Missing configuration is represented by null above. An I/O/parse failure is
    // not permission to replace the workspace's grants with installation defaults.
    throw new Error('无法读取资料库的 Agent 权限配置，任务已停止。请检查资料库后重试，系统不会改用默认权限执行。');
  }
}
