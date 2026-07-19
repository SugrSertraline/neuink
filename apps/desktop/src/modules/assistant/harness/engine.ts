import type {
  AssistantContextSnapshot,
  AssistantToolTraceEvent,
  ConversationMessage,
  LlmProfile,
  ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import {
  getAssistantContextSnapshot,
  listSkillPackages,
  loadAgentRuntimeSettings
} from '@/shared/ipc/assistantApi';
import type {
  AssistantActiveNote,
  AssistantActiveSegment,
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
  mergeRegistrySkillPackages,
  normalizeAgentRuntimeSettings,
  readAgentRuntimeSettings,
  selectAgentExecution
} from '@/shared/lib/agentRuntimeSettings';

import { assistantContextCharBudget, assistantNoteCharBudget } from '../sdk/contextBudget';
import { answerWithKeywordGrounding, type GroundedAnswer } from '../sdk/qna';
import { registerEvidence } from '../runtime/evidenceLedger';
import { createCompiledTaskState, transitionTaskState } from '../runtime/taskState';
import { finalizeVerifiedProposals } from '../runtime/verifiedProposal';
import { AssistantVerificationError } from './verification';
import { observeAssistantContext } from './context';
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

type RunAssistantHarnessOptions = {
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
  destinationEntryId?: string | null;
  mentionScope?: ScopeSnapshot | null;
  tagMentionScopes?: Record<string, ScopeSnapshot>;
  onCreateEntry?: (title: string) => Promise<AssistantEntryMetaTarget>;
  onDelta?: (delta: string) => void;
  onNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onToolEvent?: (event: AssistantToolTraceEvent) => void;
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
    mentionScope,
    tagMentionScopes,
    onCreateEntry,
    onDelta,
    onNoteProposal,
    onToolEvent,
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

    const snapshot = await getAssistantContextSnapshot({
      activeEntryId: observed.activeEntryId,
      activeNote: observed.activeNote,
      documentCharBudget: assistantContextCharBudget(settings.max_context_length),
      noteCharBudget: assistantNoteCharBudget(settings.max_context_length),
      pinnedSegments: observed.pinnedSegments,
      root
    });
    recordNode(agentRun, onToolEvent, {
      id: `${runId}-hydrate`,
      kind: 'hydrate',
      sourceCount: snapshot.pinned_segments.length,
      summary: hydrateSummary(snapshot),
      title: 'Hydrate explicit workspace context'
    });
    throwIfAborted(abortSignal);

    const runtimeSettings = await loadWorkspaceAgentRuntimeSettings(root);
    const plan = modelDrivenPlan(question, contextPlan, snapshot);
    const invocationPlan = {
      enabledToolIds: [...runtimeSettings.mainAssistant.enabledToolIds],
      mainAssistantId: preferredAgentId ?? runtimeSettings.mainAssistant.id,
      missing: [],
      mode: 'agent_execute' as const,
      rationale: 'The model policy chooses the next action from conversation and observations.',
      skillIdsToLoad: [],
      subagentTasks: [],
      writePolicy: 'workspace_write' as const
    };
    const activeExecution = selectAgentExecution(
      runtimeSettings,
      question,
      plan,
      preferredAgentId,
      invocationPlan
    );
    const executionProfile =
      profiles.find((profile) => profile.id === activeExecution.agent.llmProfileId) ?? settings;
    activeTaskState = createCompiledTaskState({
      conversationId: conversationId ?? 'local',
      request: question,
      spec: plan
    });
    agentRun.invocationMode = 'agent_execute';
    agentRun.mainAssistantId = activeExecution.agent.id;
    upsertRunNode(agentRun, {
      agentId: activeExecution.agent.id,
      id: `${runId}-loop`,
      inputSummary: `goal=${question.slice(0, 180)}`,
      kind: 'main_assistant',
      status: 'running',
      title: 'Run model-driven Agent loop'
    });
    emitHarnessEvent(onToolEvent, {
      id: `${runId}-loop`,
      input: { goal: question },
      status: 'running',
      summary: 'Agent is deciding whether to answer, ask naturally, load a Skill, or use a tool.',
      toolName: 'agent.loop'
    });

    const grounded = await answerWithKeywordGrounding({
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
      onCreateEntry,
      onToolEvent,
      plan,
      profiles,
      question,
      root,
      runtimeSettings,
      scope,
      settings: executionProfile
    });
    throwIfAborted(abortSignal);
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
        proposalIds.length > 0 ? 'awaiting_approval' : 'completed',
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
      toolName: 'agent.loop'
    });
    onDelta?.(grounded.answer);
    return {
      ...grounded,
      agentRun: finishAgentRun(agentRun, 'succeeded'),
      plan,
      taskState: nextTaskState
    };
  } catch (error) {
    const message = errorMessage(error);
    const canceled = isAbortError(error);
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

function modelDrivenPlan(
  question: string,
  contextPlan: AssistantContextPlan | null | undefined,
  snapshot: AssistantContextSnapshot
): AssistantTaskPlan {
  const activeNoteSnapshot = snapshot.active_note;
  return {
    attachments: contextPlan?.items ?? [],
    capabilities: [
      'read_document', 'read_note', 'search_evidence', 'synthesize',
      'propose_note', 'propose_entry_meta_change', 'propose_tag_change'
    ],
    citationPolicy: 'preserve',
    confidence: 1,
    deliverables: ['chat_answer'],
    evidencePolicy: 'optional',
    intent: 'general_qa',
    missing: [],
    needsCurrentNote: false,
    needsDocumentContext: false,
    needsNoteProposal: false,
    needsSegmentSearch: false,
    rationale: 'Semantic routing is delegated to the Agent policy.',
    request: question,
    target: activeNoteSnapshot
      ? {
          entryId: activeNoteSnapshot.entry_id,
          kind: 'markdown_note',
          noteId: activeNoteSnapshot.note_id
        }
      : {
          entryId: snapshot.active_entry?.entry_id,
          kind: 'chat_only'
        },
    steps: []
  };
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
  const transcript = history
    .slice(-12)
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n');
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
  return [
    'Use a model-driven Agent loop. Interpret all user replies as natural language; never require fixed phrases, regex slots, or magic retry wording.',
    'Answer directly when no external observation or side effect is needed. Naming, summarization, wording, planning, and deciding whether to ask are model-native cognition, not tools.',
    'Call tools only for workspace observation, deterministic computation, Skill loading, or an authorized side effect. For "name and create", choose the name internally and call create_entry once. For title suggestions only, answer without tools.',
    'For note and metadata writes, create reviewable proposals. For paper-grounded content, read evidence and include source_markers in the proposal.',
    'Resolve every [C<number>] token through the Typed Mention Map below. Never search for literal C1/C2 marker text. A TagScope is already expanded into the frozen read scope. When the user asks to place, organize, or save output into an Entry/Overall reference, call note_propose_create with that reference entry_id; an Entry/Overall is a destination container, not an existing selected note.',
    'For requests to read or summarize the papers under a TagScope, treat the resolved Entry list as exhaustive: call read_entry_assistant_context for each relevant Entry. A zero-result keyword/semantic search does not prove that scoped Entries have no parsed content.',
    mentionMap ? `Current Typed Mention Map:\n${mentionMap}` : 'Current Typed Mention Map: none',
    historicalMentionMaps ? `Historical Typed Mention Maps available for continuation:\n${historicalMentionMaps}` : '',
    taskObservation,
    contextPlan?.summary ? `UI context summary (informational only; the Agent decides semantic roles): ${contextPlan.summary}` : '',
    transcript ? `Recent conversation:\n${transcript}` : ''
  ].filter(Boolean).join('\n\n');
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
    kind: 'hydrate' | 'observe';
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
    const [workspaceSettings, registrySkills] = await Promise.all([
      loadAgentRuntimeSettings(root),
      listSkillPackages(root)
    ]);
    return mergeRegistrySkillPackages(
      normalizeAgentRuntimeSettings(workspaceSettings ?? readAgentRuntimeSettings()),
      registrySkills
    );
  } catch {
    return normalizeAgentRuntimeSettings(readAgentRuntimeSettings());
  }
}
