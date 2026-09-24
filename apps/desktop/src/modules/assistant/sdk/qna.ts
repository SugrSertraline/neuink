import type { ApplicationActions } from '../runtime/applicationActions';
import type { RequestToolApproval } from '../runtime/toolApproval';
import type { RequestUserInput } from '../runtime/userInput';
import { createUserInputTool, USER_INPUT_INSTRUCTIONS } from './userInputTool';
import { bindExecutionIdentity, canReplayAssistantTool, type DurableExecution } from '../runtime/durableExecution';
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
  conversationSourceKey,
  loadPrompt
} from '@/shared/ipc/assistantApi';
import { readNote } from '@/shared/ipc/workspaceApi';
import type {
  AgentInvocationPlan,
  AssistantActiveNote,
  AssistantAgentRun,
  AssistantContext,
  AssistantContextItem,
  AssistantEntryMetaProposal,
  AssistantEntryMetaTarget,
  AssistantNoteProposal,
  AssistantTagProposal,
  AssistantTaskPlan,
  AssistantTaskState
} from '@/shared/types/assistant';
import type { AgentExecutionSelection, AgentRuntimeSettings } from '@/shared/types/agentRuntime';
import { buildAgentSystemPrompt } from '@/shared/lib/agentRuntimeSettings';

import { createAgentDriver, agentExecutors } from './agentDriver';
import { SourceLedger } from '../runtime/sourceLedger';
import { assistantContextCharBudget } from './contextBudget';
import { createAssistantTools, modelToolName, type ToolRuntimeState } from './tools';
import { Agent, RunBudget, AgentLoopGuard, AgentLoopGuardError, createAgentLoopState } from '../agent-core';
import { executionModeInstructions } from '../runtime/executionPolicy';
import { answerLightweightChat } from './lightweightChat';

export type GroundedAnswer = {
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
  conversationHistory = [],
  currentEntry,
  currentNote,
  harnessBrief,
  onAnswerReset,
  onDelta,
  onNoteProposal,
  onCreateEntry,
  onToolEvent,
  onReasoningDelta,
  plan,
  invocationPlan,
  question,
  root,
  activeExecution,
  profiles,
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
  conversationHistory?: ConversationMessage[];
  currentEntry?: { id: string; title: string } | null;
  currentNote?: AssistantActiveNote | null;
  harnessBrief?: string;
  onAnswerReset?: () => void;
  onDelta?: (delta: string) => void;
  onNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onCreateEntry?: (title: string) => Promise<AssistantEntryMetaTarget>;
  onToolEvent?: (event: AssistantToolTraceEvent) => void;
  onReasoningDelta?: (delta: string) => void;
  invocationPlan?: AgentInvocationPlan | null;
  plan?: AssistantTaskPlan;
  question: string;
  root: string;
  activeExecution?: AgentExecutionSelection | null;
  profiles?: LlmProfile[];
  runtimeSettings?: AgentRuntimeSettings | null;
  scope: ScopeSnapshot;
  settings: LlmProfile;
}): Promise<GroundedAnswer> {
  if (invocationPlan?.responseStyle === 'lightweight_chat') {
    return answerLightweightChat({ budget, execution, settings, abortSignal, question, activeExecution,
      root, scope, onAnswerReset, onDelta, onReasoningDelta });
  }
  const noteProposals = execution?.get<AssistantNoteProposal[]>('noteProposals') ?? [];
  const entryMetaProposals = execution?.get<AssistantEntryMetaProposal[]>('entryMetaProposals') ?? [];
  const tagProposals = execution?.get<AssistantTagProposal[]>('tagProposals') ?? [];
  const agentLoopState = execution?.get<ReturnType<typeof createAgentLoopState>>('loop:main') ?? createAgentLoopState(question);
  agentLoopState.status = 'running';
  agentLoopState.stopReason = undefined;
  const loopGuard = new AgentLoopGuard(agentLoopState);
  const pinned = buildPinnedContext(assistantContext?.items ?? [], 1);
  const selectedNotes = await buildSelectedMarkdownContext({
    assistantContext,
    markerStart: pinned.nextMarker,
    root
  });
  const selectedContextEntries = buildSelectedContextEntryNote(assistantContext);
  const hasExplicitContext = (assistantContext?.items ?? []).length > 0;
  const ledger = new SourceLedger(new Map(execution?.get<Array<[number, ConversationSourceLink]>>('sources') ?? [...pinned.sourceByMarker, ...selectedNotes.sourceByMarker]));
  const runtime = await createAssistantTools({
    execution,
    restoredState: execution?.get<ToolRuntimeState>('tools:main'),
    applicationActions,
    abortSignal,
    budget,
    sourceLedger: ledger,
    defaultProfile: settings,
    activeExecution,
    assistantContext,
    availableEntries,
    contextSnapshot,
    conversationHistory,
    contextBudget: assistantContextCharBudget(settings.max_context_length),
    currentEntry,
    currentNote,
    executionDepth: 0,
    initialSourceByMarker: new Map([
      ...pinned.sourceByMarker,
      ...selectedNotes.sourceByMarker
    ]),
    markerStart: selectedNotes.nextMarker,
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
    runtimeSettings,
    scope
  });
  // A host-provided UI capability, not a workspace tool or a subagent grant.
  if (requestUserInput) {
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
    (toolId) => !runtime.toolNames.includes(modelToolName(toolId))
  );
  if (unavailableRequiredTools.length > 0) {
    throw new Error(
      `当前运行缺少必需工具：${unavailableRequiredTools.join(', ')}。` +
      '任务已停止，不会改用未经允许的替代来源。'
    );
  }

  const [baseSystemPrompt, userPromptTemplate] = await Promise.all([
    loadPrompt('qna_system'),
    loadPrompt('qna_user')
  ]);
  const agentSystemPrompt = activeExecution
    ? buildAgentSystemPrompt(activeExecution.agent)
    : '';
  const invocationSystemPrompt = (invocationPlan
    ? [
        invocationPlan.executionMode ? executionModeInstructions(invocationPlan.executionMode) : '',
        `Application capability boundary (not a mandatory task plan):\n${JSON.stringify(invocationPlan)}`,
        `Frozen active Entry: ${JSON.stringify(currentEntry ?? null)}. This is context, not authorization to edit it. Explicit user references take priority.`
      ].filter(Boolean).join('\n\n')
    : '') + (requestUserInput ? `\n\n${USER_INPUT_INSTRUCTIONS}` : '');
  const prompt = renderQnaUserPrompt(userPromptTemplate, {
    currentNote: buildCurrentNoteContext(contextSnapshot),
    documentContext:
      [selectedNotes.text, selectedContextEntries].filter(Boolean).join('\n\n') ||
      noExplicitContextGuidance(hasExplicitContext),
    harnessBrief: harnessBrief || 'No harness brief was prepared.',
    pinnedContext: pinned.text || 'None',
    question,
    retrievedEvidence:
      'None yet. Use search_segments for lookup questions, then read_segment_content when a search hit needs more detail.',
    scope: buildScopeContext(scope),
    sources: [pinned.text, selectedNotes.text].filter(Boolean).join('\n\n'),
    toolNotes: buildToolNotes(runtime.toolNames, plan, activeExecution, invocationPlan)
  });
  const missingRequiredToolIds = () => {
    const completed = new Set(runtime.events.filter((event) => event.status === 'done').map((event) => event.toolName));
    return (invocationPlan?.requiredToolIds ?? []).filter((id) => !completed.has(id));
  };
  const hasProposals = () => Boolean(noteProposals.length || entryMetaProposals.length || tagProposals.length || agentLoopState.createdEntryIds.length);
  let correctionCount = 0;
  await bindExecutionIdentity(execution, 'main', {
    model: settings.model, endpoint: settings.base_url, protocol: settings.api_protocol,
    agent: activeExecution?.agent, tools: runtime.toolNames, system: [baseSystemPrompt, agentSystemPrompt, invocationSystemPrompt]
  });
  const agent = new Agent<ModelMessage>({
    driver: createAgentDriver({
      budget,
      settings,
      system: [baseSystemPrompt, agentSystemPrompt, invocationSystemPrompt].filter(Boolean).join('\n\n'),
      tools: runtime.tools,
      onTurn: onAnswerReset,
      onDelta,
      onReasoningDelta
    }),
    tools: agentExecutors(runtime.tools, requestToolApproval),
    checkpoint: execution?.actor<ModelMessage>('main'),
    canReplayTool: canReplayAssistantTool,
    saveCheckpoint: execution ? async (checkpoint) => {
      execution.set('noteProposals', noteProposals);
      execution.set('entryMetaProposals', entryMetaProposals);
      execution.set('tagProposals', tagProposals);
      execution.set('loop:main', agentLoopState);
      execution.set('tools:main', runtime.snapshot());
      execution.set('sources', [...ledger.sources]);
      await execution.saveActor('main', checkpoint);
    } : undefined,
    messages: [{ role: 'user', content: prompt }],
    budget,
    signal: abortSignal,
    maxTurns: agentLoopState.maxTurns,
    beforeTurn: () => loopGuard.startTurn(),
    isFatal: (error) => error instanceof AgentLoopGuardError,
    onToolError: (call, error) => onToolEvent?.({
      id: call.id, toolName: call.name, status: 'error', error: errorMessage(error)
    }),
    verify: (text) => {
      const missing = missingRequiredToolIds();
      const invalidCitation = [...text.matchAll(/\[S(\d+)]/g)].some((match) => !ledger.sources.has(Number(match[1])));
      const evidenceRead = runtime.events.some(event => event.status === 'done' && (event.sources?.length ?? 0) > 0);
      const uncited = (requiresGroundedSources(plan) || (plan?.executionMode !== undefined && evidenceRead)) && !hasProposals() &&
        ![...text.matchAll(/\[S(\d+)]/g)].some((match) => ledger.sources.has(Number(match[1])));
      if (!missing.length && !invalidCitation && !uncited && (text.trim() || hasProposals())) return;
      if (correctionCount++ >= 2) throw new Error('Agent 未满足工具、溯源或输出合同，任务已停止。');
      return [
        missing.length ? `Call these required tools before answering: ${missing.join(', ')}.` : '',
        invalidCitation || uncited ? 'Use only evidence obtained in this run and cite valid [Sx] markers. Read evidence with the available tools if needed. Do not invent sources.' : '',
        !text.trim() && !hasProposals() ? 'Complete the requested answer or proposal using the actual observations above.' : ''
      ].filter(Boolean).join('\n');
    }
  });
  let answer: string;
  try {
    answer = await agent.run();
  } catch (error) {
    agentLoopState.status = abortSignal?.aborted ? 'cancelled' : 'failed';
    agentLoopState.stopReason = errorMessage(error);
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

  const citedAnswer = normalizeCitedSources(answer.trim(), runtime.sourceByMarker);
  agentLoopState.status = noteProposals.length > 0 || entryMetaProposals.length > 0 || tagProposals.length > 0
    ? 'awaiting_approval'
    : 'completed';
  const grounded = {
    agentLoopState,
    ...citedAnswer,
    entryMetaProposals,
    noteProposals,
    tagProposals,
    sources: uniqueConversationSources([
      ...citedAnswer.sources,
      ...entryMetaProposals.flatMap((proposal) => proposal.sources.map((source) => ({
        entry_id: source.entryId,
        entry_title: source.entryTitle,
        page_idx: source.pageIdx,
        quote: source.quote,
        segment_uid: source.segmentUid
      })))
    ]),
    toolEvents: runtime.events
  };
  return grounded;
}

function buildPinnedContext(items: AssistantContextItem[], markerStart: number) {
  const sourceByMarker = new Map<number, ConversationSourceLink>();
  const lines: string[] = [];
  let marker = markerStart;

  for (const item of items) {
    if (item.kind !== 'segment') {
      continue;
    }
    sourceByMarker.set(marker, {
      entry_id: item.entryId,
      entry_title: item.entryTitle,
      segment_uid: item.segmentUid,
      page_idx: item.pageIdx,
      quote: compactQuote(item.text)
    });
    lines.push(`[S${marker}] ${item.entryTitle}, p.${item.pageIdx + 1}\n${item.text}`);
    marker += 1;
  }

  return {
    nextMarker: marker,
    sourceByMarker,
    text: lines.join('\n\n')
  };
}

function buildSelectedContextEntryNote(assistantContext?: AssistantContext | null) {
  const entries = (assistantContext?.items ?? []).filter(
    (item): item is Extract<AssistantContextItem, { kind: 'entry' }> =>
      item.kind === 'entry' && item.contentKind !== 'note'
  );
  if (entries.length === 0) {
    return '';
  }
  return [
    'Selected context entries were explicitly added by the user and are the document-level research scope, not individual excerpts.',
    ...entries.map((entry) =>
      `- ${entry.entryTitle}${entry.contentKind && entry.contentKind !== 'entry' ? ` / ${entry.contentTitle ?? entry.contentKind}` : ''} (${entry.entryId})`
    ),
    'Use read_entry_assistant_context with these entry IDs, or search_segments scoped to these entry IDs, before synthesizing from them.'
  ].join('\n');
}

export async function buildSelectedMarkdownContext({
  assistantContext,
  markerStart,
  root
}: {
  assistantContext?: AssistantContext | null;
  markerStart: number;
  root: string;
}) {
  const sourceByMarker = new Map<number, ConversationSourceLink>();
  const sections: string[] = [];
  const seen = new Set<string>();
  let marker = markerStart;

  for (const item of assistantContext?.items ?? []) {
    if (item.kind !== 'entry' || item.contentKind !== 'note' || !item.contentId) continue;
    const key = `${item.entryId}:${item.contentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const note = await readNote(root, item.entryId, item.contentId);
    let markdown = note.markdown;
    for (const link of note.links) {
      const source = link.sources[0];
      const anchor = `[^${link.anchor_id}]`;
      if (!source || !markdown.includes(anchor)) continue;
      sourceByMarker.set(marker, {
        entry_id: source.entry_id,
        entry_title: source.entry_id,
        page_idx: Math.max(0, source.page - 1),
        quote: source.snapshot_text,
        segment_uid: source.segment_uid
      });
      markdown = markdown.split(anchor).join(`[S${marker}]`);
      marker += 1;
    }
    sections.push(`Selected Markdown note: ${note.title}\n${markdown}`);
  }

  return { nextMarker: marker, sourceByMarker, text: sections.join('\n\n---\n\n') };
}

export function uniqueContextDocumentItems(items: AssistantContextItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.kind !== 'entry' || item.contentKind === 'note') return false;
    const key = `document:${item.entryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function requiresGroundedSources(plan?: AssistantTaskPlan | null) {
  return plan?.citationPolicy === 'required' ||
    plan?.capabilities.includes('search_evidence') ||
    plan?.intent === 'paper_qa' ||
    plan?.intent === 'paper_search' ||
    plan?.intent === 'paper_summary';
}

function normalizeCitedSources(
  answer: string,
  sourceByMarker: Map<number, ConversationSourceLink>
): GroundedAnswer {
  const citedMarkers: number[] = [];
  for (const match of answer.matchAll(/\[S(\d+)]/g)) {
    const marker = Number(match[1]);
    if (sourceByMarker.has(marker) && !citedMarkers.includes(marker)) {
      citedMarkers.push(marker);
    }
  }

  if (citedMarkers.length === 0) {
    return {
      answer,
      sources: []
    };
  }

  const renumbered = new Map(citedMarkers.map((marker, index) => [marker, index + 1]));
  const normalizedAnswer = answer.replace(/\[S(\d+)]/g, (full, markerText: string) => {
    const nextMarker = renumbered.get(Number(markerText));
    return nextMarker ? `[S${nextMarker}]` : full;
  });

  return {
    answer: normalizedAnswer,
    sources: citedMarkers
      .map((marker) => sourceByMarker.get(marker))
      .filter((source): source is ConversationSourceLink => Boolean(source))
  };
}

function renderQnaUserPrompt(
  template: string,
  values: {
    documentContext: string;
    pinnedContext: string;
    question: string;
    currentNote: string;
    retrievedEvidence: string;
    harnessBrief: string;
    scope: string;
    sources: string;
    toolNotes: string;
  }
) {
  const replacements: Record<string, string> = {
    current_note: values.currentNote,
    document_context: values.documentContext,
    harness_brief: values.harnessBrief,
    pinned_context: values.pinnedContext,
    question: values.question,
    retrieved_evidence: values.retrievedEvidence,
    scope: values.scope,
    sources: values.sources,
    tool_notes: values.toolNotes
  };

  return Object.entries(replacements).reduce(
    (prompt, [key, value]) => prompt.split(`{{${key}}}`).join(value),
    template
  );
}

function buildScopeContext(scope: ScopeSnapshot) {
  const entries = scope.entry_ids
    .map((entryId, index) => {
      const title = scope.entry_titles[index] ?? entryId;
      return `- ${title} (${entryId})`;
    })
    .slice(0, 30);

  return [
    scope.tag_names.length > 0 ? `Tags: ${scope.tag_names.join(' / ')}` : '',
    entries.length > 0 ? `Entries:\n${entries.join('\n')}` : 'Entries: all parsed entries'
  ]
    .filter(Boolean)
    .join('\n');
}

function buildCurrentNoteContext(contextSnapshot?: AssistantContextSnapshot | null) {
  const hydratedNote = contextSnapshot?.active_note ?? null;

  if (hydratedNote) {
    return [
      'A Markdown note was explicitly selected and backend-hydrated.',
      `Entry: ${hydratedNote.entry_title} (${hydratedNote.entry_id})`,
      `Note: ${hydratedNote.note_title} (${hydratedNote.note_id})`,
      `Markdown chars: ${hydratedNote.markdown_char_count}`,
      `Source links: ${hydratedNote.source_link_count}`,
      hydratedNote.truncated
        ? 'The hydrated note body is truncated; avoid full-note replacement unless the visible body is sufficient.'
        : 'The complete note body is available in the Harness Brief when relevant.'
    ].join('\n');
  }

  return 'No Markdown note was explicitly selected for this chat. If the user asks to edit a note without specifying one, ask which note or entry they want to use.';
}

function noExplicitContextGuidance(hasExplicitContext: boolean) {
  return hasExplicitContext
    ? 'No parsed document context is available for the explicitly selected context items.'
    : [
        'No entry, note, or excerpt was explicitly selected for this chat.',
        'The frozen active Entry in the Harness Brief is the default paper context when present.',
        'If neither selected context nor a frozen active Entry exists, ask the user to select content. If it is a general question, answer normally.'
      ].join('\n');
}

function buildToolNotes(
  toolNames: string[],
  plan?: AssistantTaskPlan,
  activeExecution?: AgentExecutionSelection | null,
  invocationPlan?: AgentInvocationPlan | null
) {
  return [
    `Available tools: ${toolNames.join(', ')}.`,
    invocationPlan
      ? `Runtime selected mode=${invocationPlan.mode}, writePolicy=${invocationPlan.writePolicy}.`
      : '',
    invocationPlan?.requiredToolIds?.length
      ? `Execution contract requires these tools before a final answer, in task order: ${invocationPlan.requiredToolIds.join(', ')}.`
      : 'No tool call is mandatory for this general task.',
    invocationPlan?.sourcePolicy
      ? `Source policy: ${invocationPlan.sourcePolicy}. Do not substitute a different source when the policy is not mixed.`
      : '',
    activeExecution
      ? `Current agent: ${activeExecution.agent.name}.`
      : '',
    'Tool calls are scoped to the frozen Neuink task context. Explicit @ selections and pinned Segments take priority over the active Entry.',
    'Tools return evidence markers like [S1]. Cite only markers that appear in pinned context or tool output.',
    'In Markdown note proposals, place [S#] inline beside the specific claim or list item it supports. Do not put markers on separate lines or collect them in an end-of-note sources list. source_markers only declares metadata; it does not place citations. For patches, cite in the actual inserted/replacement text.',
    'At every step, check the frozen target, available tools, previous observations, and the remaining execution contract. If a required action cannot be completed, report the concrete blocker instead of claiming success.',
    plan?.editCoordinatePolicy === 'line_and_hash'
      ? 'For Markdown changes, read the current note first and use replace_lines, delete_lines, or insert_lines with exact 1-based logical Markdown line coordinates and expected_text. Do not regenerate or replace unrelated note content.'
      : '',
    plan?.needsSegmentSearch ? 'Planner requires search_segments before answering if evidence is not already pinned.' : '',
    plan?.needsDocumentContext ? 'Router requires document context. Use explicit @ selections first, otherwise use the frozen active Entry from the Harness.' : ''
  ].join('\n');
}

function uniqueConversationSources(sources: ConversationSourceLink[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = conversationSourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactQuote(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
