import type { ApplicationActions } from '../runtime/applicationActions';
import type { RequestToolApproval } from '../runtime/toolApproval';
import type { RequestUserInput } from '../runtime/userInput';
import { runDurableHarness } from './durableHarness';
import type { DurableExecution } from '../runtime/durableExecution';
import type { RunBudget } from '../agent-core';
import { MEMORY_PROMPT, resolveModelProfile } from '../sdk/modelTasks';
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

import { assistantContextCharBudget, assistantNoteCharBudget } from '../sdk/contextBudget';
import { answerWithGroundedAgent, type GroundedAnswer } from '../sdk/qna';
import { registerEvidence } from '../runtime/evidenceLedger';
import { createCompiledTaskState, transitionTaskState } from '../runtime/taskState';
import { finalizeVerifiedProposals } from '../runtime/verifiedProposal';
import { AssistantVerificationError } from './verification';
import { verifyHarnessResult } from './verification';
import { observeAssistantContext } from './context';
import { buildDirectExecution } from '../runtime/executionPolicy';
import { routeAssistantRequest, routeSummary, type RequestRoute } from '../runtime/requestRouter';
import {
  appendConversationMemory,
  buildConversationTail,
  shouldUpdateConversationMemory,
  updateConversationMemory
} from './conversationMemory';
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
  preferredAgentId?: string | null;
  profiles?: LlmProfile[];
  question: string;
  resumeFromNodeId?: string | null;
  resumedFromRunId?: string | null;
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
      activeEntryId: observed.activeEntryId,
      activeNote: observed.activeNote,
      documentCharBudget: assistantContextCharBudget(settings.max_context_length),
      noteCharBudget: assistantNoteCharBudget(settings.max_context_length),
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
    const delegatedCalls = new Set<string>();
    const grounded = await answerWithGroundedAgent({
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
      conversationHistory,
      currentEntry: snapshot.active_entry
        ? { id: snapshot.active_entry.entry_id, title: snapshot.active_entry.entry_title }
        : currentEntry,
      currentNote: activeNote(snapshot) ?? currentNote,
      harnessBrief: modelDrivenBrief({
        composerSnapshot,
        contextPlan,
        history: conversationHistory,
        mentionScope: mentionScope ?? scope,
        tagMentionScopes
      }),
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
        if (event.toolName === 'task.run_subagent') {
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
    if (shouldUpdateConversationMemory(conversationHistory, question, grounded.answer)) {
      upsertRunNode(agentRun, {
        agentId: 'conversation-memory',
        id: `${runId}-memory`,
        kind: 'planner',
        status: 'running',
        title: 'Update semantic memory checkpoint'
      });
      const memoryProfile = settings;
      emitHarnessEvent(onToolEvent, {
        id: `${runId}-memory`, status: 'running', toolName: 'agent.memory',
        summary: '对话达到记忆整理阈值，正在保存摘要。'
      });
      try {
        grounded.conversationMemory = await updateConversationMemory({
          budget: options.budget,
          abortSignal,
          answer: grounded.answer,
          history: conversationHistory,
          pendingProposalCount: proposalIds.length,
          question,
          settings: memoryProfile,
          sourceCount: grounded.sources.length,
          systemPrompt: MEMORY_PROMPT
        });
        emitHarnessEvent(onToolEvent, {
          id: `${runId}-memory`, status: 'done', toolName: 'agent.memory', summary: '对话摘要已整理。'
        });
        upsertRunNode(agentRun, {
          agentId: 'conversation-memory',
          id: `${runId}-memory`,
          kind: 'planner',
          outputSummary: `summary=${grounded.conversationMemory.summary.slice(0, 180)}`,
          status: 'succeeded',
          title: 'Update semantic memory checkpoint'
        });
      } catch (memoryError) {
        throwIfAborted(abortSignal);
        upsertRunNode(agentRun, {
          agentId: 'conversation-memory',
          error: errorMessage(memoryError),
          id: `${runId}-memory`,
          kind: 'planner',
          status: 'failed',
          title: 'Update semantic memory checkpoint'
        });
        emitHarnessEvent(onToolEvent, {
          error: errorMessage(memoryError),
          id: `${runId}-memory`,
          status: 'error',
          summary: 'The semantic memory checkpoint was not updated; the durable transcript remains available.',
          toolName: 'agent.memory'
        });
      }
    }
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

export function modelDrivenBrief({
  composerSnapshot,
  contextPlan,
  history,
  mentionScope,
  tagMentionScopes
}: {
  composerSnapshot?: AssistantComposerSnapshot | null;
  contextPlan?: AssistantContextPlan | null;
  history: ConversationMessage[];
  mentionScope: ScopeSnapshot;
  tagMentionScopes?: Record<string, ScopeSnapshot>;
}) {
  const transcript = buildConversationTail(history);
  const mentionMap = formatMentionMap(composerSnapshot, mentionScope, tagMentionScopes);
  const historicalMentionMaps = history
    .filter((message) => message.role === 'user')
    .flatMap((message) => (message.parts ?? []).flatMap((part) =>
      part.type === 'context-snapshot' && part.composer?.mentions.length
        ? [{ content: message.content, snapshot: part.composer }]
        : []
    ))
    .slice(-4)
    .map(({ content, snapshot }) =>
      `For prior user request ${JSON.stringify(content)}:\n${formatMentionMap(snapshot, mentionScope)}`
    )
    .join('\n\n');
  const latestTask = [...history]
    .reverse()
    .flatMap((message) => [...(message.parts ?? [])].reverse())
    .find((part) => part.type === 'task-state');
  const taskObservation = latestTask?.type === 'task-state'
    ? `Previous task state: status=${latestTask.task.status}, goal=${JSON.stringify(latestTask.task.goal.normalizedGoal)}, proposals=${latestTask.task.proposalIds.length}. A later natural-language request may continue, correct, or replace it; decide from the conversation.`
    : '';
  return appendConversationMemory([
    'Use a model-driven Agent loop. Interpret all user replies as natural language; never require fixed phrases, regex slots, or magic retry wording.',
    'Answer directly when no external observation or side effect is needed. Naming, summarization, wording, planning, and deciding whether to ask are model-native cognition, not tools.',
    'Call tools only for workspace observation, deterministic computation, or an authorized side effect. For "name and create", choose the name internally and call create_entry once. For title suggestions only, answer without tools.',
    'For note and metadata writes, create reviewable proposals. For paper-grounded content, read evidence and include source_markers in the proposal. In Markdown notes, also put [S#] inline beside each supported claim or list item (inside inserted/replacement text for patches). Never collect markers at the end; source_markers is metadata, not citation placement.',
    'Every state-changing action requires explicit confirmation in the application UI. Proposal creation is NOT application. create_entry, app_set_appearance and external MCP calls pause for user confirmation before execution. Never claim success before a successful tool result, never infer confirmation from conversation text, and never bypass or repeat a rejected action.',
    'Resolve every [C<number>] token through the Typed Mention Map below. Never search for literal C1/C2 marker text. A TagScope is already expanded into the frozen read scope. When the user asks to place, organize, or save output into an Entry/Overall reference, call note_propose_create with that reference entry_id; an Entry/Overall is a destination container, not an existing selected note.',
    'For requests to read or summarize the papers under a TagScope, treat the resolved Entry list as exhaustive: call read_entry_assistant_context for each relevant Entry. A zero-result keyword/semantic search does not prove that scoped Entries have no parsed content.',
    mentionMap ? `Current Typed Mention Map:\n${mentionMap}` : 'Current Typed Mention Map: none',
    historicalMentionMaps ? `Historical Typed Mention Maps available for continuation:\n${historicalMentionMaps}` : '',
    taskObservation,
    contextPlan?.summary ? `UI context summary (informational only; the Agent decides semantic roles): ${contextPlan.summary}` : '',
    transcript ? `Recent conversation:\n${transcript}` : ''
  ].filter(Boolean).join('\n\n'), history);
}

function formatMentionMap(
  composerSnapshot: AssistantComposerSnapshot | null | undefined,
  mentionScope: ScopeSnapshot,
  tagMentionScopes?: Record<string, ScopeSnapshot>
) {
  return (composerSnapshot?.mentions ?? []).map((mention) => {
    if (mention.kind === 'tag') {
      const resolvedScope = mention.tagId ? tagMentionScopes?.[mention.tagId] : undefined;
      return `${mention.marker} = TagScope { tag_id: ${mention.tagId ?? 'unknown'}, tag_name: ${JSON.stringify(mention.tagName ?? mention.label)}, resolved_entry_ids: ${JSON.stringify((resolvedScope ?? mentionScope).entry_ids)} }`;
    }
    return `${mention.marker} = ContextReference { kind: ${mention.kind}, entry_id: ${mention.entryId}, entry_title: ${JSON.stringify(mention.entryTitle)}, content_id: ${mention.contentId ?? 'none'}, content_title: ${JSON.stringify(mention.contentTitle ?? '')} }`;
  }).join('\n');
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
  history = [],
  proposals,
  sources
}: {
  composerSnapshot?: AssistantComposerSnapshot | null;
  history?: ConversationMessage[];
  proposals: AssistantNoteProposal[];
  sources: GroundedAnswer['sources'];
}) {
  const historicalMentions = history.flatMap((message) => (message.parts ?? []).flatMap((part) =>
    part.type === 'context-snapshot' ? part.composer?.mentions ?? [] : []
  ));
  const hasEvidenceReference = [
    ...(composerSnapshot?.mentions ?? []),
    ...historicalMentions
  ].some((mention) =>
    mention.kind === 'tag' || mention.kind === 'pdf' || mention.kind === 'reflow' ||
    mention.kind === 'segment' || mention.kind === 'overview'
  );
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
