import { generateText, stepCountIs, streamText } from 'ai';

import type {
  AssistantContextSnapshot,
  AssistantToolTraceEvent,
  ConversationMessage,
  ConversationSourceLink,
  LlmProfile,
  ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import {
  loadPrompt,
  readEntryAssistantContext,
  searchSegmentsTool
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

import { createNeuinkModel, generationSettings } from './provider';
import { assistantContextCharBudget } from './contextBudget';
import { createAssistantTools } from './tools';
import { AgentLoopGuard, createAgentLoopState } from '../agent-core';

export type GroundedAnswer = {
  agentLoopState?: import('@/shared/types/agentRuntime').AgentLoopState;
  agentRun?: AssistantAgentRun;
  answer: string;
  entryMetaProposals?: AssistantEntryMetaProposal[];
  noteProposals?: AssistantNoteProposal[];
  tagProposals?: AssistantTagProposal[];
  plan?: AssistantTaskPlan;
  sources: ConversationSourceLink[];
  taskState?: AssistantTaskState;
  toolEvents?: AssistantToolTraceEvent[];
};

type EvidenceSections = {
  documentContext: string;
  pinnedContext: string;
  retrievedEvidence: string;
};

type EvidenceBundle = {
  sections: EvidenceSections;
  sourceByMarker: Map<number, ConversationSourceLink>;
};

export async function answerWithKeywordGrounding({
  abortSignal,
  assistantContext,
  availableEntries,
  contextSnapshot,
  conversationHistory,
  currentEntry,
  currentNote,
  harnessBrief,
  onDelta,
  onNoteProposal,
  onCreateEntry,
  onToolEvent,
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
  abortSignal?: AbortSignal;
  assistantContext?: AssistantContext | null;
  availableEntries?: AssistantEntryMetaTarget[];
  contextSnapshot?: AssistantContextSnapshot | null;
  conversationHistory?: ConversationMessage[];
  currentEntry?: { id: string; title: string } | null;
  currentNote?: AssistantActiveNote | null;
  harnessBrief?: string;
  onDelta?: (delta: string) => void;
  onNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onCreateEntry?: (title: string) => Promise<AssistantEntryMetaTarget>;
  onToolEvent?: (event: AssistantToolTraceEvent) => void;
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
  let streamedWithTools = false;
  let toolActivity = false;

  try {
    const toolAnswer = await generateGroundedAnswerWithTools({
      abortSignal,
      assistantContext,
      availableEntries,
      contextSnapshot,
      conversationHistory,
      currentEntry,
      currentNote,
      harnessBrief,
      onDelta: (delta) => {
        streamedWithTools = true;
        onDelta?.(delta);
      },
      onNoteProposal,
      onCreateEntry,
      onToolEvent: (event) => {
        toolActivity = true;
        onToolEvent?.(event);
      },
      plan,
      invocationPlan,
      question,
      root,
      activeExecution,
      profiles,
      runtimeSettings,
      scope,
      settings
    });

    if (
      (toolAnswer.answer.trim() ||
        (toolAnswer.entryMetaProposals?.length ?? 0) > 0 ||
        (toolAnswer.noteProposals?.length ?? 0) > 0 ||
        (toolAnswer.tagProposals?.length ?? 0) > 0 ||
        (toolAnswer.agentLoopState?.createdEntryIds.length ?? 0) > 0) &&
      (!requiresGroundedSources(plan) || toolAnswer.sources.length > 0)
    ) {
      return toolAnswer;
    }
  } catch (error) {
    if (invocationPlan?.writePolicy === 'proposal_only') {
      throw error;
    }
    if (streamedWithTools || toolActivity) {
      throw error;
    }

    onToolEvent?.({
      error: `Tool calling unavailable; using structured evidence fallback. ${errorMessage(error)}`,
      id: `tool-fallback-${Date.now()}`,
      status: 'error',
      toolName: 'assistant_tools'
    });
  }

  const evidence = await buildEvidence({
    assistantContext,
    question,
    root,
    scope,
    settings
  });

  if (!hasEvidence(evidence.sections)) {
    return {
      answer:
        'The current scope does not have parsed PDF context available for this question. Open a parsed Entry or add a Segment to the chat context first.',
      sources: []
    };
  }

  return generateGroundedAnswer({
    abortSignal,
    harnessBrief,
    onDelta: streamedWithTools ? undefined : onDelta,
    question,
    scope,
    sections: evidence.sections,
    settings,
    sourceByMarker: evidence.sourceByMarker
  });
}

async function generateGroundedAnswerWithTools({
  abortSignal,
  assistantContext,
  availableEntries = [],
  contextSnapshot,
  conversationHistory = [],
  currentEntry,
  currentNote,
  harnessBrief,
  onDelta,
  onNoteProposal,
  onCreateEntry,
  onToolEvent,
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
  abortSignal?: AbortSignal;
  assistantContext?: AssistantContext | null;
  availableEntries?: AssistantEntryMetaTarget[];
  contextSnapshot?: AssistantContextSnapshot | null;
  conversationHistory?: ConversationMessage[];
  currentEntry?: { id: string; title: string } | null;
  currentNote?: AssistantActiveNote | null;
  harnessBrief?: string;
  onDelta?: (delta: string) => void;
  onNoteProposal?: (proposal: AssistantNoteProposal) => void;
  onCreateEntry?: (title: string) => Promise<AssistantEntryMetaTarget>;
  onToolEvent?: (event: AssistantToolTraceEvent) => void;
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
  const noteProposals: AssistantNoteProposal[] = [];
  const entryMetaProposals: AssistantEntryMetaProposal[] = [];
  const tagProposals: AssistantTagProposal[] = [];
  const agentLoopState = createAgentLoopState(question);
  const loopGuard = new AgentLoopGuard(agentLoopState);
  const pinned = buildPinnedContext(assistantContext?.items ?? [], 1);
  const selectedNotes = await buildSelectedMarkdownContext({
    assistantContext,
    markerStart: pinned.nextMarker,
    root
  });
  const selectedContextEntries = buildSelectedContextEntryNote(assistantContext);
  const hasExplicitContext = (assistantContext?.items ?? []).length > 0;
  const runtime = await createAssistantTools({
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

  const [baseSystemPrompt, userPromptTemplate] = await Promise.all([
    loadPrompt('qna_system'),
    loadPrompt('qna_user')
  ]);
  const model = createNeuinkModel(settings);
  const agentSystemPrompt = activeExecution
    ? buildAgentSystemPrompt(
        activeExecution.agent,
        activeExecution.skillPackages,
        invocationPlan?.skillIdsToLoad ?? []
      )
    : '';
  const invocationSystemPrompt = invocationPlan
    ? `ThinkerAgent Invocation Plan:\n${JSON.stringify(invocationPlan)}`
    : '';
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
  const consumeStream = async (stream: AsyncIterable<any>) => {
    for await (const part of stream) {
      if (part.type === 'start-step') {
        loopGuard.startTurn();
        continue;
      }
      if (part.type === 'text-delta') {
        answer += part.text;
        onDelta?.(part.text);
        continue;
      }
      if (part.type === 'tool-error') {
        onToolEvent?.({
          error: errorMessage(part.error),
          id: part.toolCallId,
          status: 'error',
          toolName: String(part.toolName)
        });
        continue;
      }
      if (part.type === 'error') throw new Error(errorMessage(part.error));
    }
  };
  let answer = '';
  const result = streamText({
    abortSignal,
    ...generationSettings(settings),
    model,
    prompt,
    stopWhen: stepCountIs(agentLoopState.maxTurns),
    system: [baseSystemPrompt, agentSystemPrompt, invocationSystemPrompt].filter(Boolean).join('\n\n'),
    tools: runtime.tools
  });
  await consumeStream(result.fullStream);

  const hasMaterialResult = () => Boolean(
    answer.trim() || noteProposals.length || entryMetaProposals.length ||
    tagProposals.length || agentLoopState.createdEntryIds.length
  );
  if (!hasMaterialResult() && runtime.observations.length > 0) {
    const observationText = JSON.stringify(runtime.observations).slice(0, 24_000);
    const continuation = streamText({
      abortSignal,
      ...generationSettings(settings),
      model,
      prompt: `${prompt}\n\nThe previous tool round ended without a final response. Continue the same task from these actual tool observations:\n${observationText}\n\nDo not repeat a failed search unchanged. For an exhaustive TagScope request, read each resolved Entry directly with read_entry_assistant_context. Complete the requested proposal or explain a concrete remaining blocker.`,
      stopWhen: stepCountIs(Math.max(1, agentLoopState.maxTurns - agentLoopState.turnCount)),
      system: [baseSystemPrompt, agentSystemPrompt, invocationSystemPrompt].filter(Boolean).join('\n\n'),
      tools: runtime.tools
    });
    await consumeStream(continuation.fullStream);
  }
  if (!hasMaterialResult()) {
    agentLoopState.status = 'failed';
    agentLoopState.stopReason = 'Agent tool loop ended without a final response or proposal.';
    throw new Error(agentLoopState.stopReason);
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
  return requiresGroundedSources(plan)
    ? ensureGroundedCitations({
        abortSignal,
        grounded,
        settings,
        sourceByMarker: runtime.sourceByMarker
      })
    : grounded;
}

async function buildEvidence({
  assistantContext,
  question,
  root,
  scope,
  settings
}: {
  assistantContext?: AssistantContext | null;
  question: string;
  root: string;
  scope: ScopeSnapshot;
  settings: LlmProfile;
}): Promise<EvidenceBundle> {
  let nextMarker = 1;
  const sourceByMarker = new Map<number, ConversationSourceLink>();
  const sections: EvidenceSections = {
    documentContext: '',
    pinnedContext: '',
    retrievedEvidence: ''
  };
  const contextItems = assistantContext?.items ?? [];
  const hydratedDocumentEntries = new Set<string>();
  for (const item of contextItems) {
    if (item.kind === 'segment') {
      const pinned = buildPinnedContext([item], nextMarker);
      sections.pinnedContext = [sections.pinnedContext, pinned.text]
        .filter(Boolean)
        .join('\n\n');
      nextMarker = pinned.nextMarker;
      mergeSourceMaps(sourceByMarker, pinned.sourceByMarker);
      continue;
    }
    if (item.contentKind === 'note') {
      const noteContext = await buildSelectedMarkdownContext({
        assistantContext: { items: [item] },
        markerStart: nextMarker,
        root
      });
      sections.documentContext = [sections.documentContext, noteContext.text]
        .filter(Boolean)
        .join('\n\n');
      nextMarker = noteContext.nextMarker;
      mergeSourceMaps(sourceByMarker, noteContext.sourceByMarker);
      continue;
    }
    if (hydratedDocumentEntries.has(item.entryId)) continue;
    hydratedDocumentEntries.add(item.entryId);
    const selectedEntry = await buildSelectedEntryDocumentContext({
      entries: [item],
      markerStart: nextMarker,
      root,
      settings
    });
    sections.documentContext = [sections.documentContext, selectedEntry.text]
      .filter(Boolean)
      .join('\n\n');
    nextMarker = selectedEntry.nextMarker;
    mergeSourceMaps(sourceByMarker, selectedEntry.sourceByMarker);
  }

  const shouldRetrieve = shouldUseRetrievalQuestion(question) || scope.entry_ids.length !== 1;

  if (!sections.documentContext && !shouldRetrieve && scope.entry_ids.length === 1) {
    const document = await buildEntryDocumentContext({
      entryId: scope.entry_ids[0],
      markerStart: nextMarker,
      root,
      settings
    });
    sections.documentContext = document.text;
    nextMarker = document.nextMarker;
    mergeSourceMaps(sourceByMarker, document.sourceByMarker);
    return { sections, sourceByMarker };
  }

  const retrieved = await buildRetrievedEvidence({
    markerStart: nextMarker,
    question,
    root,
    scope
  });
  sections.retrievedEvidence = retrieved.text;
  nextMarker = retrieved.nextMarker;
  mergeSourceMaps(sourceByMarker, retrieved.sourceByMarker);

  if (!sections.retrievedEvidence && scope.entry_ids.length === 1 && !sections.documentContext) {
    const document = await buildEntryDocumentContext({
      entryId: scope.entry_ids[0],
      markerStart: nextMarker,
      root,
      settings
    });
    sections.documentContext = document.text;
    mergeSourceMaps(sourceByMarker, document.sourceByMarker);
  }

  return { sections, sourceByMarker };
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

async function buildSelectedEntryDocumentContext({
  entries,
  markerStart,
  root,
  settings
}: {
  entries: AssistantContextItem[];
  markerStart: number;
  root: string;
  settings: LlmProfile;
}) {
  const sourceByMarker = new Map<number, ConversationSourceLink>();
  const sections: string[] = [];
  let marker = markerStart;

  for (const entry of entries) {
    if (entry.kind !== 'entry') {
      continue;
    }
    const document = await buildEntryDocumentContext({
      entryId: entry.entryId,
      markerStart: marker,
      root,
      settings
    });
    if (document.text) {
      sections.push(
        `Context entry: ${entry.entryTitle}${entry.contentKind && entry.contentKind !== 'entry' ? ` / ${entry.contentTitle ?? entry.contentKind}` : ''}\n${document.text}`
      );
      mergeSourceMaps(sourceByMarker, document.sourceByMarker);
      marker = document.nextMarker;
    } else {
      sections.push(`Context entry: ${entry.entryTitle}\nNo parsed PDF context available.`);
    }
  }

  return {
    nextMarker: marker,
    sourceByMarker,
    text: sections.join('\n\n')
  };
}

async function buildEntryDocumentContext({
  entryId,
  markerStart,
  root,
  settings
}: {
  entryId: string;
  markerStart: number;
  root: string;
  settings: LlmProfile;
}) {
  const entryContext = await readEntryAssistantContext({ root, entryId });
  const sourceByMarker = new Map<number, ConversationSourceLink>();

  if (!entryContext.markdown.trim()) {
    return {
      nextMarker: markerStart,
      sourceByMarker,
      text: ''
    };
  }

  const budget = assistantContextCharBudget(settings.max_context_length);
  const trimmed = trimToBudget(entryContext.markdown, budget);
  const text = trimmed.replace(/\[S(\d+)]/g, (_, markerText: string) => {
    const originalMarker = Number(markerText);
    return `[S${markerStart + originalMarker - 1}]`;
  });

  for (let index = 0; index < entryContext.sources.length; index += 1) {
    const originalMarker = index + 1;
    if (!trimmed.includes(`[S${originalMarker}]`)) {
      continue;
    }
    sourceByMarker.set(markerStart + index, entryContext.sources[index]);
  }

  return {
    nextMarker: markerStart + entryContext.sources.length,
    sourceByMarker,
    text
  };
}

async function buildRetrievedEvidence({
  markerStart,
  question,
  root,
  scope
}: {
  markerStart: number;
  question: string;
  root: string;
  scope: ScopeSnapshot;
}) {
  const sourceByMarker = new Map<number, ConversationSourceLink>();
  const searchResults = await searchSegmentsTool({
    root,
    query: question,
    scopeEntryIds: scope.entry_ids,
    topK: 8
  });
  const hits = searchResults.entries.flatMap((group) => group.hits).slice(0, 24);
  const lines: string[] = [];
  let marker = markerStart;

  for (const hit of hits) {
    if (hit.target.kind !== 'segment') {
      continue;
    }
    if (marker >= markerStart + 8) {
      break;
    }
    const source: ConversationSourceLink = {
      entry_id: hit.target.entry_id,
      entry_title: hit.entry_title,
      segment_uid: hit.target.segment_uid,
      page_idx: hit.target.page_idx,
      quote: hit.snippet
    };
    sourceByMarker.set(marker, source);
    lines.push(`[S${marker}] ${hit.entry_title}, p.${hit.target.page_idx + 1}\n${hit.snippet}`);
    marker += 1;
  }

  return {
    nextMarker: marker,
    sourceByMarker,
    text: lines.join('\n\n')
  };
}

async function generateGroundedAnswer({
  abortSignal,
  harnessBrief,
  onDelta,
  question,
  scope,
  sections,
  settings,
  sourceByMarker
}: {
  abortSignal?: AbortSignal;
  harnessBrief?: string;
  onDelta?: (delta: string) => void;
  question: string;
  scope: ScopeSnapshot;
  sections: EvidenceSections;
  settings: LlmProfile;
  sourceByMarker: Map<number, ConversationSourceLink>;
}): Promise<GroundedAnswer> {
  const [systemPrompt, userPromptTemplate] = await Promise.all([
    loadPrompt('qna_system'),
    loadPrompt('qna_user')
  ]);
  const model = createNeuinkModel(settings);
  const prompt = renderQnaUserPrompt(userPromptTemplate, {
    currentNote: 'Note changes are handled by the Proposal runtime after synthesis.',
    documentContext: sections.documentContext || 'None',
    harnessBrief: harnessBrief || 'No harness brief was prepared.',
    pinnedContext: sections.pinnedContext || 'None',
    question,
    retrievedEvidence: sections.retrievedEvidence || 'None',
    scope: buildScopeContext(scope),
    sources: combinedSources(sections),
    toolNotes: 'Use only the supplied grounded context. Do not make capability claims.'
  });

  if (onDelta) {
    const result = streamText({
      abortSignal,
      ...generationSettings(settings),
      model,
      system: systemPrompt,
      prompt
    });
    let answer = '';

    for await (const delta of result.textStream) {
      answer += delta;
      onDelta(delta);
    }

    return ensureGroundedCitations({
      abortSignal,
      grounded: normalizeCitedSources(answer.trim(), sourceByMarker),
      settings,
      sourceByMarker
    });
  }

  const result = await generateText({
    ...generationSettings(settings),
    model,
    system: systemPrompt,
    prompt
  });

  return ensureGroundedCitations({
    abortSignal,
    grounded: normalizeCitedSources(result.text.trim(), sourceByMarker),
    settings,
    sourceByMarker
  });
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

async function ensureGroundedCitations({
  abortSignal,
  grounded,
  settings,
  sourceByMarker
}: {
  abortSignal?: AbortSignal;
  grounded: GroundedAnswer;
  settings: LlmProfile;
  sourceByMarker: Map<number, ConversationSourceLink>;
}) {
  if (grounded.sources.length > 0 || sourceByMarker.size === 0 || !grounded.answer.trim()) {
    return grounded;
  }
  const evidence = [...sourceByMarker.entries()]
    .slice(0, 24)
    .map(([marker, source]) =>
      `[S${marker}] ${source.entry_title}, p.${source.page_idx + 1}\n${source.quote}`
    )
    .join('\n\n');
  const revised = await generateText({
    abortSignal,
    ...generationSettings(settings),
    model: createNeuinkModel(settings),
    system: 'Revise the answer using only the supplied evidence. Preserve useful Markdown and cite every paper-grounded claim with valid [Sx] markers. Return only the revised answer.',
    prompt: `Draft answer:\n${grounded.answer}\n\nEvidence:\n${evidence}`
  });
  return {
    ...grounded,
    ...normalizeCitedSources(revised.text.trim(), sourceByMarker)
  };
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

function shouldUseRetrieval(question: string) {
  return /找|查|定位|在哪里|实验|方法|结果|数据集|消融|对比|find|locate|where|experiment|method|result|dataset|ablation|baseline|table|figure/i.test(
    question
  );
}

function hasEvidence(sections: EvidenceSections) {
  return Boolean(
    sections.documentContext.trim() ||
      sections.pinnedContext.trim() ||
      sections.retrievedEvidence.trim()
  );
}

function shouldUseRetrievalQuestion(question: string) {
  return /找|查找|定位|在哪|实验|方法|结果|数据集|消融|对比|表格|图片|结论|find|locate|where|experiment|method|result|dataset|ablation|baseline|table|figure|conclusion/i.test(
    question
  );
}

function combinedSources(sections: EvidenceSections) {
  return [
    sections.documentContext ? `Document Context:\n${sections.documentContext}` : '',
    sections.pinnedContext ? `Pinned Context:\n${sections.pinnedContext}` : '',
    sections.retrievedEvidence ? `Retrieved Evidence:\n${sections.retrievedEvidence}` : ''
  ]
    .filter(Boolean)
    .join('\n\n');
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
      ? `Runtime selected mode=${invocationPlan.mode}, writePolicy=${invocationPlan.writePolicy}, skillsToLoad=${invocationPlan.skillIdsToLoad.join(', ') || 'none'}.`
      : '',
    activeExecution
      ? `Current agent: ${activeExecution.agent.name}. Available skill metadata: ${activeExecution.skillPackages.map((skillPackage) => skillPackage.name).join(', ') || 'none'}. Use skill_load before relying on a full SKILL.md.`
      : '',
    'Tool calls are scoped to the frozen Neuink task context. Explicit @ selections and pinned Segments take priority over the active Entry.',
    'Tools return evidence markers like [S1]. Cite only markers that appear in pinned context or tool output.',
    'Skill scripts are auxiliary resources. Do not execute scripts unless an MCP tool or approved Tool Package exposes that execution with permissions.',
    plan?.needsSegmentSearch ? 'Planner requires search_segments before answering if evidence is not already pinned.' : '',
    plan?.needsDocumentContext ? 'Router requires document context. Use explicit @ selections first, otherwise use the frozen active Entry from the Harness.' : ''
  ].join('\n');
}

function mergeSourceMaps(
  target: Map<number, ConversationSourceLink>,
  source: Map<number, ConversationSourceLink>
) {
  for (const [marker, sourceLink] of source) {
    target.set(marker, sourceLink);
  }
}

function uniqueConversationSources(sources: ConversationSourceLink[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.entry_id}:${source.segment_uid}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactQuote(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function trimToBudget(text: string, budget: number) {
  if (text.length <= budget) {
    return text;
  }

  return `${text.slice(0, budget)}\n\n[Context truncated because it exceeds the configured model context length.]`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
