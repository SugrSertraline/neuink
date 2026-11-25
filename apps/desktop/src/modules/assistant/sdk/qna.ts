import { readUnifiedRetrieval } from '@/shared/lib/retrievalMode';
import type { ApplicationActions } from '../runtime/applicationActions';
import type { RequestToolApproval } from '../runtime/toolApproval';
import type { RequestUserInput } from '../runtime/userInput';
import { createUserInputTool } from './userInputTool';
import type { BrowserTabTarget } from '@/shared/ipc/browserApi';
import { bindExecutionIdentity, canReplayAssistantTool, type DurableExecution } from '../runtime/durableExecution';
import { renderConversationContext, lastMemoryCheckpointIndex } from '../runtime/conversationTranscript';
import { conversationTranscriptSources, transcriptObservations, latestContextUsage, citationDisplayContext } from '../runtime/modelTranscript';
import { projectionRetainedMessages } from './contextProjection';
import { prepareContextRequest } from '../context/request';
import { observeWorkspaceContext } from '../context/observation';
import { composeSystemPolicy } from '../context/policy';
import type { AssistantContextUsage } from '@/shared/types/modelTranscript';
import { createTranscriptRecorder } from '../runtime/transcriptRecorder';
import type { AssistantModelTranscript } from '@/shared/types/modelTranscript';
import type { ModelMessage } from 'ai';

import type {
  AssistantContextSnapshot,
  AssistantConversationMemory,
  AssistantToolTraceEvent,
  ConversationMessage,
  ConversationSourceLink,
  LlmProfile,
  ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import {
  resolveLlmApiProtocol,
  loadPrompt
} from '@/shared/ipc/assistantApi';
import type {
  AgentInvocationPlan,
  AssistantActiveNote,
  AssistantAgentRun,
  AssistantContext,
  AssistantComposerSnapshot,
  AssistantEntryMetaProposal,
  AssistantEntryMetaTarget,
  AssistantNoteProposal,
  AssistantTagProposal,
  AssistantTaskPlan,
  AssistantTaskState
} from '@/shared/types/assistant';
import type { AgentExecutionSelection, AgentRuntimeSettings } from '@/shared/types/agentRuntime';
import { buildAgentSystemPrompt } from '@/shared/lib/agentRuntimeSettings';
import { assistantErrorDiagnostic } from '@/shared/lib/assistantDebug';
import { matchedExternalCitationUrls, normalizeReturnedExternalCitationLinks, returnedExternalCitationUrls } from './citationContract';
import { answerVerification } from './answerVerification';
import { normalizeCitedSources, uniqueConversationSources } from './citationSources';

import { createAgentDriver, agentExecutors } from './agentDriver';
import { SourceLedger } from '../runtime/sourceLedger';
import { assistantContextCharBudget } from './contextBudget';
import { createAssistantTools, type ToolRuntimeState } from './tools';
import { mcpModelToolName } from './toolSchema';
import { Agent, RunBudget, AgentLoopGuard, AgentLoopGuardError, createAgentLoopState } from '../agent-core';
import { canParallelAssistantTool } from '../runtime/executionPolicy';
import { answerLightweightChat } from './lightweightChat';

import { paperRecords, presentedPaperRecords } from '../research/paperPresentation';
import { researchPapersFromEvents } from '../research/researchPaperSelection';

export type GroundedAnswer = {
  /** Retained with a durable result so redelivery can reconnect the native conversation. */
  localAgentSession?: import('../local-agent/session').LocalAgentSession;
  /** Host-observed failures, not a model-authored completion claim. */
  hadRecoverableFailures?: boolean;
  /** Exact external URLs matched against successful host tool observations. */
  externalCitationUrls?: string[];
  executionId?: string;
  agentLoopState?: import('@/shared/types/agentRuntime').AgentLoopState;
  agentRun?: AssistantAgentRun;
  answer: string;
  conversationMemory?: AssistantConversationMemory | null;
  entryMetaProposals?: AssistantEntryMetaProposal[];
  noteProposals?: AssistantNoteProposal[];
  tagProposals?: AssistantTagProposal[];
  plan?: AssistantTaskPlan;
  sources: ConversationSourceLink[];
  taskState?: AssistantTaskState;
  toolEvents?: AssistantToolTraceEvent[];
  turnDurationsMs?: number[];
  modelTranscript?: AssistantModelTranscript;
};

export async function answerWithGroundedAgent({
  budget = new RunBudget(),
  execution,
  applicationActions,
  requestToolApproval,
  requestUserInput,
  abortSignal,
  assistantContext,
  availableEntries = [],
  contextSnapshot,
  composerSnapshot,
  tagMentionScopes,
  browserTabTarget,
  conversationHistory = [],
  conversationMemory,
  currentEntry,
  currentNote,
  onAnswerReset,
  onDelta,
  onNoteProposal,
  onCreateEntry,
  onToolEvent,
  onReasoningDelta,
  onModelTranscript,
  plan,
  invocationPlan,
  question,
  root,
  activeExecution,
  profiles,
  retrievalScope,
  runtimeSettings,
  scope,
  settings
}: {
  budget?: RunBudget;
  execution?: DurableExecution;
  applicationActions?: ApplicationActions;
  requestToolApproval?: RequestToolApproval;
  requestUserInput?: RequestUserInput;
  abortSignal?: AbortSignal;
  assistantContext?: AssistantContext | null;
  availableEntries?: AssistantEntryMetaTarget[];
  contextSnapshot?: AssistantContextSnapshot | null;
  composerSnapshot?: AssistantComposerSnapshot | null;
  tagMentionScopes?: Record<string, ScopeSnapshot>;
  browserTabTarget?: BrowserTabTarget | null;
  conversationHistory?: ConversationMessage[];
  /** The newest persisted compaction checkpoint, sent as the first conversation turn. */
  conversationMemory?: AssistantConversationMemory | null;
  currentEntry?: { id: string; title: string } | null;
  currentNote?: AssistantActiveNote | null;
  onAnswerReset?: () => void;
  onDelta?: (delta: string) => void;
  onNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onCreateEntry?: (title: string) => Promise<AssistantEntryMetaTarget>;
  onToolEvent?: (event: AssistantToolTraceEvent) => void;
  onReasoningDelta?: (delta: string) => void;
  onModelTranscript?: (transcript: AssistantModelTranscript) => void | Promise<void>;
  invocationPlan?: AgentInvocationPlan | null;
  plan?: AssistantTaskPlan;
  question: string;
  root: string;
  activeExecution?: AgentExecutionSelection | null;
  profiles?: LlmProfile[];
  retrievalScope?: ScopeSnapshot;
  runtimeSettings?: AgentRuntimeSettings | null;
  scope: ScopeSnapshot;
  settings: LlmProfile;
}): Promise<GroundedAnswer> {
  if (invocationPlan?.responseStyle === 'lightweight_chat') {
    return answerLightweightChat({ budget, execution, settings, abortSignal, question, activeExecution,
      root, scope, currentEntry, currentNote, contextSnapshot, assistantContext, composerSnapshot, tagMentionScopes,
      browserTabTarget, conversationHistory, conversationMemory, onModelTranscript, onAnswerReset, onDelta, onReasoningDelta });
  }
  const noteProposals = execution?.get<AssistantNoteProposal[]>('noteProposals') ?? [];
  const entryMetaProposals = execution?.get<AssistantEntryMetaProposal[]>('entryMetaProposals') ?? [];
  const tagProposals = execution?.get<AssistantTagProposal[]>('tagProposals') ?? [];
  const agentLoopState = execution?.get<ReturnType<typeof createAgentLoopState>>('loop:main') ?? createAgentLoopState(question);
  agentLoopState.status = 'running';
  agentLoopState.stopReason = undefined;
  const loopGuard = new AgentLoopGuard(agentLoopState);
  const historicalSources = conversationTranscriptSources(conversationHistory);
  const firstNewMarker = Math.max(0, ...historicalSources.keys()) + 1;
  const historicalObservations = transcriptObservations(conversationHistory);
  const historicalEvents = conversationHistory.flatMap(message => message.tool_events ?? [])
    .filter(event => event.status === 'done' && event.researchPapers?.length);
  const ledger = new SourceLedger(new Map(execution?.get<Array<[number, ConversationSourceLink]>>('sources') ?? historicalSources));
  const runtime = await createAssistantTools({
    tagMentionScopes,
    execution,
    restoredState: execution?.get<ToolRuntimeState>('tools:main'),
    applicationActions,
    abortSignal,
    budget,
    sourceLedger: ledger,
    historicalSourceMarkers: new Set(historicalSources.keys()),
    defaultProfile: settings,
    activeExecution,
    assistantContext,
    availableEntries,
    contextSnapshot,
    browserTabTarget,
    conversationHistory,
    contextBudget: assistantContextCharBudget(settings.max_context_length),
    currentEntry,
    currentNote,
    executionDepth: 0,
    unifiedRetrieval: (await readUnifiedRetrieval()) ? {} : null,
    markerStart: firstNewMarker,
    loopGuard,
    onCreateEntry,
    onNoteProposal: (proposal) => {
      noteProposals.push(proposal);
      onNoteProposal?.(proposal);
    },
    onEntryMetaProposal: (proposal) => {
      entryMetaProposals.push(proposal);
    },
    onTagProposal: (proposal) => {
      tagProposals.push(proposal);
    },
    onToolEvent,
    plan,
    invocationPlan,
    profiles,
    root,
    retrievalScope,
    runtimeSettings,
    scope
  });
  // A host-provided UI capability, not a workspace tool or a subagent grant.
  const savedToolNames = execution?.get<{ toolNames?: string[] }>('tools:main')?.toolNames;
  const canAskUser = requestUserInput && (!savedToolNames || savedToolNames.includes('ask_user'));
  if (canAskUser) {
    runtime.tools.ask_user = createUserInputTool(requestUserInput, () => {
      const result: ConversationSourceLink[] = [];
      for (const [marker, source] of runtime.sourceByMarker) result[marker - 1] = source;
      return result;
    }, event => {
      const index = runtime.events.findIndex(value => value.id === event.id);
      if (index < 0) runtime.events.push(event); else runtime.events[index] = event;
      onToolEvent?.(event);
    });
    runtime.toolNames.push('ask_user');
  }
  const unavailableRequiredTools = (invocationPlan?.requiredToolIds ?? []).filter(
    (toolId) => !runtime.toolNames.includes(toolId.startsWith('mcp.') ? mcpModelToolName(toolId) : toolId)
  );
  const availabilityNotes = [...runtime.availabilityNotes,
    ...(unavailableRequiredTools.length ? [`这些原计划工具当前不可用：${unavailableRequiredTools.join(', ')}。不要调用它们；仅使用实际允许的替代工具或明确说明未完成部分，不能声称已完成这些操作。`] : [])];

  const baseSystemPrompt = await loadPrompt('qna_system');
  const agentSystemPrompt = activeExecution
    ? `<agent_profile>\n${buildAgentSystemPrompt(activeExecution.agent)}\n</agent_profile>` : '';
  const system = composeSystemPolicy(baseSystemPrompt, agentSystemPrompt);
  const workspace = await observeWorkspaceContext({ scope, assistantContext, composerSnapshot, tagMentionScopes,
    currentEntry, currentNote, contextSnapshot, browserTabTarget });
  const missingRequiredToolIds = () => {
    const attempted = new Set(runtime.events.filter((event) => event.status === 'done' || event.status === 'error').map((event) => event.toolName));
    return (invocationPlan?.requiredToolIds ?? []).filter((id) => !unavailableRequiredTools.includes(id)
      && !attempted.has(id));
  };
  const hasProposals = () => Boolean(noteProposals.length || entryMetaProposals.length || tagProposals.length || agentLoopState.createdEntryIds.length);
  let correctionCount = 0;
  const transcriptModel = { profileId: settings.id, model: settings.model, protocol: resolveLlmApiProtocol(settings.api_protocol) };
  const memoryPart = conversationHistory[lastMemoryCheckpointIndex(conversationHistory)]?.parts?.find(part => part.type === 'memory');
  const currentMemory = conversationMemory ?? (memoryPart?.type === 'memory' ? memoryPart.memory : null);
  const prepared = prepareContextRequest({ history: renderConversationContext(conversationHistory, transcriptModel, currentMemory),
    workspace, question, observations: availabilityNotes, policy: { mode: invocationPlan?.executionMode ?? 'act',
      write_policy: invocationPlan?.writePolicy ?? 'proposal_only', source_policy: invocationPlan?.sourcePolicy ?? 'mixed',
      required_tools: invocationPlan?.requiredToolIds ?? [] } });
  const initialMessages = [...prepared.messages.slice(0, prepared.historyLength), ...prepared.inputMessages];
  const recording = createTranscriptRecorder({ execution, model: transcriptModel, initialMessageCount: initialMessages.length,
    inputMessages: prepared.inputMessages, sources: ledger.sources, firstNewMarker, onTranscript: onModelTranscript,
    contextUsage: () => driver.contextUsage() });
  const citationObservations = () => [...historicalObservations, ...runtime.observations];
  await bindExecutionIdentity(execution, 'main', {
    model: settings.model, endpoint: settings.base_url, protocol: settings.api_protocol,
    agent: activeExecution?.agent, tools: runtime.identityToolNames, system
  });
  const driver = createAgentDriver({
    budget,
    settings,
    runStartIndex: recording.startIndex,
    initialMemory: currentMemory,
    initialUsage: execution?.get<AssistantContextUsage>('contextUsage:main') ?? latestContextUsage(conversationHistory, transcriptModel),
    onUsage: usage => execution?.set('contextUsage:main', usage),
    system,
    tools: runtime.tools,
    entryContextReadLimit: plan?.intent === 'paper_search' ? 2 : plan?.intent === 'paper_summary' ? 5 : 6,
    onTurn: onAnswerReset,
    onDelta,
    onReasoningDelta,
    projection: {
      restored: execution?.get('projection:main'),
      onState: (state) => execution?.set('projection:main', state)
    }
  });
  const agent = new Agent<ModelMessage>({
    driver,
    tools: agentExecutors(runtime.tools, requestToolApproval),
    checkpoint: execution?.actor<ModelMessage>('main'),
    canReplayTool: canReplayAssistantTool,
    canParallelTool: (name, input) => canParallelAssistantTool(name, input, runtime.observations),
    saveCheckpoint: async (checkpoint) => {
      if (execution) {
        execution.set('noteProposals', noteProposals);
        execution.set('entryMetaProposals', entryMetaProposals);
        execution.set('tagProposals', tagProposals);
        execution.set('loop:main', agentLoopState);
        execution.set('tools:main', runtime.snapshot());
        execution.set('sources', [...ledger.sources]);
        await execution.saveActor('main', checkpoint);
      }
      await recording.save(checkpoint);
    },
    // The whole conversation is the run's transcript; the current request is its last turn.
    messages: initialMessages,
    budget,
    signal: abortSignal,
    maxTurns: agentLoopState.maxTurns,
    synthesisReserveTurns: ['paper_qa', 'paper_search', 'paper_summary'].includes(plan?.intent ?? '') ? 2 : 0,
    beforeTurn: () => loopGuard.startTurn(),
    isFatal: (error) => error instanceof AgentLoopGuardError,
    toolErrorDiagnostic: assistantErrorDiagnostic,
    onToolError: (call, error, failure) => {
      const event: AssistantToolTraceEvent = { id: call.id, toolName: call.name, input: call.input, status: 'error',
        summary: failure.message, error: assistantErrorDiagnostic(error) };
      const index = runtime.events.findIndex(value => value.id === call.id);
      if (index < 0) runtime.events.push(event);
      else runtime.events[index] = { ...runtime.events[index], ...event };
      onToolEvent?.(runtime.events[index < 0 ? runtime.events.length - 1 : index]);
    },
    verify: (text) => {
      const issue = answerVerification({ answer: text, question, plan, sources: ledger.sources,
        events: runtime.events, observations: runtime.observations, historicalObservations, historicalEvents, hasProposals: hasProposals(),
        availabilityNotes, missing: missingRequiredToolIds() });
      if (!issue) return;
      if (correctionCount++ >= 2) throw new Error(issue.message);
      return issue.correction;
    }
  });
  const turnDurationsMs: number[] = [];
  let currentTurnStartedAt: number | null = null;
  agent.subscribe((event) => {
    if (event.type === 'turn_start') {
      currentTurnStartedAt = Date.now();
    } else if (event.type === 'turn_end' && currentTurnStartedAt !== null) {
      turnDurationsMs.push(Math.max(0, Date.now() - currentTurnStartedAt));
      currentTurnStartedAt = null;
    }
  });
  let answer: string;
  try {
    answer = normalizeReturnedExternalCitationLinks(await agent.run(), returnedExternalCitationUrls(citationObservations()));
  } catch (error) {
    agentLoopState.status = abortSignal?.aborted ? 'cancelled' : 'failed';
    agentLoopState.stopReason = assistantErrorDiagnostic(error);
    throw error;
  }
  const hasMaterialResult = () => Boolean(answer.trim() || hasProposals());
  if (!hasMaterialResult()) {
    agentLoopState.status = 'failed';
    agentLoopState.stopReason = 'Agent tool loop ended without a final response or proposal.';
    throw new Error(agentLoopState.stopReason);
  }
  const skippedRequiredTools = missingRequiredToolIds();
  if (skippedRequiredTools.length > 0) {
    agentLoopState.status = 'failed';
    agentLoopState.stopReason = `Agent 未完成必需工具调用：${skippedRequiredTools.join(', ')}。`;
    throw new Error(
      `${agentLoopState.stopReason}执行合同未满足，任务已停止。`
    );
  }

  const citedAnswer = normalizeCitedSources(answer.trim(), runtime.sourceByMarker, runtime.events);
  await recording.finish(citedAnswer.sources);
  const projection = driver.projectionState();
  const displayContext = citationDisplayContext(recording.current?.displaySourceMarkers);
  const compactedMemory: AssistantConversationMemory | undefined = projection ? {
    ...projection.memory,
    observed_markers: projection.markers,
    message_count: conversationHistory.filter(message => !message.message_id.startsWith('client-')).length + 2,
    pending_proposal_count: noteProposals.length + entryMetaProposals.length + tagProposals.length,
    source_count: ledger.sources.size,
    updated_at: new Date().toISOString(),
    retained_context: { version: 2, ...transcriptModel,
      messages: JSON.parse(JSON.stringify([...projectionRetainedMessages(projection, agent.messages),
        ...(displayContext ? [displayContext] : [])])) as ModelMessage[] }
  } : undefined;
  const selectedPapers = researchPapersFromEvents([...historicalEvents, ...runtime.events]);
  const records = paperRecords(selectedPapers.map(item => item.paper), [...ledger.sources.values()], selectedPapers);
  agentLoopState.status = noteProposals.length > 0 || entryMetaProposals.length > 0 || tagProposals.length > 0
    ? 'awaiting_approval'
    : 'completed';
  const grounded = {
    hadRecoverableFailures: availabilityNotes.length > 0 || runtime.events.some(event => event.status === 'error'),
    agentLoopState,
    ...citedAnswer,
    externalCitationUrls: matchedExternalCitationUrls(answer, returnedExternalCitationUrls(citationObservations()), records),
    entryMetaProposals,
    noteProposals,
    tagProposals,
    sources: uniqueConversationSources([
      ...citedAnswer.sources,
      ...presentedPaperRecords(answer, records).flatMap(record => record.kind === 'sciverse' ? [record.source] : []),
      ...entryMetaProposals.flatMap((proposal) => proposal.sources.map((source) => ({
        entry_id: source.entryId,
        entry_title: source.entryTitle,
        page_idx: source.pageIdx,
        quote: source.quote,
        segment_uid: source.segmentUid
      })))
    ]),
    turnDurationsMs,
    toolEvents: runtime.events,
    modelTranscript: recording.current,
    conversationMemory: compactedMemory
  };
  return grounded;
}
