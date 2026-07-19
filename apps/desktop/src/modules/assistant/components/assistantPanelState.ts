import {
  ArrowDown,
  Archive,
  Check,
  FileDown,
  FileText,
  History,
  Info,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Plus,
  Send,
  Square,
  Settings,
  Trash2,
  X
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { collectDescendantTagIds } from '@/modules/library/utils/tagTree';
import {
  appendConversationMessages,
  createConversation,
  deleteAgentRun,
  deleteConversation,
  getCachedConversations,
  getLlmSettings,
  listAgentRuns,
  listConversations,
  loadConversation,
  renameConversation,
  saveAgentRun,
  setTaskLlmProfile,
  subscribeLlmSettings,
  updateConversationMessage,
  type AssistantConversationMemory,
  type AssistantMessagePart,
  type AssistantToolTraceEvent,
  type Conversation,
  type ConversationMessage,
  type ConversationMeta,
  type ConversationSourceLink,
  type LlmProfile,
  type ScopeSnapshot
} from '@/shared/ipc/assistantApi';
import type {
  AssistantAgentRun,
  AssistantActiveNote,
  AssistantActiveSegment,
  AssistantComposerSnapshot,
  AssistantContext,
  AssistantContextInput,
  AssistantContextItem,
  AssistantContextPlan,
  AssistantEntryMetaProposal,
  AssistantNoteProposal,
  AssistantTagProposal,
  AssistantTaskPlan,
  AssistantTaskState
} from '@/shared/types/assistant';
import type { TagMeta } from '@/shared/types/domain';
import { useToast } from '@/shared/hooks/useToast';

import { ChatMessage } from './ChatMessage';
import { AssistantRunStatus } from './AssistantRunStatus';
import {
  AssistantComposerEditor,
  type AssistantComposerDraft
} from './AssistantComposerEditor';
import { visibleConversationHistory } from './conversationHistory';
import { useAssistantAutoScroll } from './useAssistantAutoScroll';
import {
  assistantRunBaseScope,
  buildAssistantScope,
  buildConversationMentionScope,
  buildTagMentionScopes,
  composerMentionsFromMessages,
  mergeScopeSnapshots,
  mergeScopeWithContextEntries
} from './assistantScope';
import {
  activeContentMention,
  activeEntryMention,
  composerBlocksEqual,
  composerBlocksLogicalLength,
  composerBlocksToLogicalText,
  composerBlocksToText,
  externalAssistantContextItems,
  hasPersistableAssistantContext,
  findAdjacentComposerContextBlock,
  normalizeComposerInputBlocks,
  orderedAssistantContextItems,
  removeComposerMentionRange,
  removeFirstComposerContextBlock,
  replaceComposerTextRange,
  syncComposerContextBlocks,
  type ComposerBlock
} from './assistantComposerBlocks';
import {
  getComposerCaretOffset,
  getComposerSelectionOffsets,
  readComposerBlocks,
  setComposerCaretOffset
} from './assistantComposerDom';
import {
  contextItemChipTitle,
  contextItemLabel,
  entryContentTargets,
  entryContextKey,
  entryMarkdownTargets,
  entryOriginalTarget,
  entryTargetLabel,
  entryTargetMenuLabel,
  radialOptionPosition,
  radialTargetIndex,
  radialTargetsForEntry,
  scopeLabel,
  targetContextItemId,
  type EntryContextTarget
} from './assistantContextTargets';
import { AssistantHarnessError, runAssistantHarness } from '../harness/engine';
import { planAssistantContext } from '../harness/contextPlanner';
import { estimateTokensFromChars, modelContextTokens } from '../sdk/contextBudget';

type AssistantPanelProps = {
  activeEntry: LibraryEntry | null;
  activeTag: string | null;
  assistantContext: AssistantContext;
  composerDraft: AssistantComposerDraft | null;
  activeNote: AssistantActiveNote | null;
  activeSegment: AssistantActiveSegment | null;
  draftQuestion: string | null;
  entries: LibraryEntry[];
  root: string | null;
  status: 'loading' | 'ready' | 'error';
  tags: TagMeta[];
  onClearAssistantContext: () => void;
  onComposerDraftChange: (draft: AssistantComposerDraft | null) => void;
  onCreateAssistantEntry: (title: string) => Promise<LibraryEntry>;
  onApplyNoteProposal: (proposal: AssistantNoteProposal) => Promise<AssistantNoteProposal>;
  onApplyEntryMetaProposal: (proposal: AssistantEntryMetaProposal) => Promise<void>;
  onApplyTagProposal: (proposal: AssistantTagProposal) => Promise<void>;
  onAddAssistantContext: (context: AssistantContextInput) => void;
  onDraftQuestionConsumed: () => void;
  onExportConversation: (conversation: Conversation) => Promise<void>;
  onOpenSettings: () => void;
  onOpenSource: (source: ConversationSourceLink) => void;
  onReplaceAssistantContext: (items: AssistantContextInput[]) => void;
  onRemoveAssistantContextItem: (itemId: string) => void;
};

const CONTEXT_WARNING_RATIO = 0.7;
const CONTEXT_WARNING_MIN_TOKENS = 32_000;

type AssistantBackgroundRunSnapshot = {
  abortController: AbortController;
  conversation: Conversation | null;
  conversationId: string | null;
  error: string | null;
  noteProposalsByMessageId: Record<string, AssistantNoteProposal[]>;
  question: string;
  root: string;
  streamingMessageId: string | null;
  toolEventsByMessageId: Record<string, AssistantToolTraceEvent[]>;
};

type QueuedAssistantDraft = {
  activeEntry: { id: string; title: string } | null;
  activeNote: AssistantActiveNote | null;
  activeSegment: AssistantActiveSegment | null;
  contextItems: AssistantContextItem[];
  contextPlan: AssistantContextPlan | null;
  question: string;
  snapshot: AssistantComposerSnapshot;
};

let assistantBackgroundRun: AssistantBackgroundRunSnapshot | null = null;
const assistantBackgroundRunListeners = new Set<() => void>();
const STREAM_RENDER_INTERVAL_MS = 50;
const INITIAL_MESSAGE_RENDER_LIMIT = 30;

export function setAssistantBackgroundRun(
  patch:
    | AssistantBackgroundRunSnapshot
    | null
    | ((current: AssistantBackgroundRunSnapshot | null) => AssistantBackgroundRunSnapshot | null)
) {
  assistantBackgroundRun = typeof patch === 'function' ? patch(assistantBackgroundRun) : patch;
  for (const listener of assistantBackgroundRunListeners) {
    listener();
  }
}

export function subscribeAssistantBackgroundRun(listener: () => void) {
  assistantBackgroundRunListeners.add(listener);
  return () => {
    assistantBackgroundRunListeners.delete(listener);
  };
}

export function syncAssistantBackgroundRunState({
  abortController,
  conversation,
  error,
  noteProposalsByMessageId,
  streamingMessageId,
  toolEventsByMessageId
}: {
  abortController: AbortController;
  conversation?: Conversation | null;
  error?: string | null;
  noteProposalsByMessageId?: Record<string, AssistantNoteProposal[]>;
  streamingMessageId?: string | null;
  toolEventsByMessageId?: Record<string, AssistantToolTraceEvent[]>;
}) {
  setAssistantBackgroundRun((current) =>
    current?.abortController === abortController
      ? {
          ...current,
          ...(conversation !== undefined
            ? {
                conversation,
                conversationId: conversation?.id ?? current.conversationId
              }
            : null),
          ...(error !== undefined ? { error } : null),
          ...(noteProposalsByMessageId !== undefined ? { noteProposalsByMessageId } : null),
          ...(streamingMessageId !== undefined ? { streamingMessageId } : null),
          ...(toolEventsByMessageId !== undefined ? { toolEventsByMessageId } : null)
        }
      : current
  );
}


export function useStableEvent<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback((...args: TArgs) => handlerRef.current(...args), []);
}

export function createOptimisticMessageId(role: ConversationMessage['role']) {
  return `client-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function updateConversationMessageLocally(
  conversation: Conversation | null,
  messageId: string | null,
  patch: Partial<
    Pick<
      ConversationMessage,
      'content' | 'note_proposals' | 'parts' | 'source_links' | 'tool_events'
    >
  >,
  conversationId: string
) {
  if (!conversation || conversation.id !== conversationId || !messageId) {
    return conversation;
  }

  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.message_id === messageId ? { ...message, ...patch } : message
    )
  };
}

export function createOptimisticMessage(
  role: ConversationMessage['role'],
  content: string,
  sourceLinks: ConversationSourceLink[] = [],
  messageId = createOptimisticMessageId(role),
  contextItems: AssistantContextItem[] = [],
  composerSnapshot?: AssistantComposerSnapshot | null,
  contextPlan?: AssistantContextPlan | null
): ConversationMessage {
  return {
    message_id: messageId,
    role,
    content,
    parts: buildAssistantMessageParts({
      composerSnapshot,
      content,
      contextItems,
      contextPlan,
      sourceLinks
    }),
    source_links: sourceLinks,
    created_at: new Date().toISOString()
  };
}

export function createSyntheticConversationMessage(
  role: ConversationMessage['role'],
  content: string,
  sourceLinks: ConversationSourceLink[] = [],
  noteProposals: AssistantNoteProposal[] = []
): ConversationMessage {
  return {
    message_id: `synthetic-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    note_proposals: noteProposals,
    parts: [],
    source_links: sourceLinks,
    created_at: new Date().toISOString()
  };
}

export function buildAssistantMessageParts({
  agentRun,
  composerSnapshot,
  content,
  contextItems = [],
  contextPlan,
  entryMetaProposals = [],
  memory,
  noteProposals = [],
  tagProposals = [],
  plan,
  sourceLinks = [],
  taskState,
  toolEvents = []
}: {
  agentRun?: AssistantAgentRun;
  composerSnapshot?: AssistantComposerSnapshot | null;
  content: string;
  contextItems?: AssistantContextItem[];
  contextPlan?: AssistantContextPlan | null;
  entryMetaProposals?: AssistantEntryMetaProposal[];
  memory?: AssistantConversationMemory | null;
  noteProposals?: AssistantNoteProposal[];
  tagProposals?: AssistantTagProposal[];
  plan?: AssistantTaskPlan;
  sourceLinks?: ConversationSourceLink[];
  taskState?: AssistantTaskState;
  toolEvents?: AssistantToolTraceEvent[];
}): AssistantMessagePart[] {
  const parts: AssistantMessagePart[] = [];

  if (agentRun) {
    parts.push({
      run: agentRun,
      type: 'agent-run'
    });
  }

  if (plan) {
    parts.push({
      plan,
      type: 'plan'
    });
  }

  if (memory) {
    parts.push({
      memory,
      type: 'memory'
    });
  }

  if (hasPersistableAssistantContext(contextItems, composerSnapshot)) {
    parts.push({
      composer: composerSnapshot ?? null,
      items: cloneAssistantContextItems(contextItems),
      plan: contextPlan ?? null,
      type: 'context-snapshot'
    });
    parts.push({
      items: cloneAssistantContextItems(contextItems),
      type: 'context'
    });
  }

  for (const event of toolEvents) {
    parts.push({
      args: event.input,
      id: event.id,
      status: event.status,
      toolName: event.toolName,
      type: 'tool-call'
    });

    if (event.summary) {
      parts.push({
        id: event.id,
        sourceLinks: event.sources,
        summary: event.summary,
        toolName: event.toolName,
        type: 'tool-result'
      });
    }

    if (event.error) {
      parts.push({
        id: event.id,
        message: event.error,
        toolName: event.toolName,
        type: 'error'
      });
    }
  }

  if (content.trim()) {
    parts.push({
      markdown: content,
      type: 'text'
    });
  }

  for (const source of sourceLinks) {
    parts.push({
      source,
      type: 'source'
    });
  }

  for (const proposal of noteProposals) {
    parts.push({
      proposal,
      type: 'note-proposal'
    });
  }

  for (const proposal of entryMetaProposals) {
    parts.push({ proposal, type: 'entry-meta-proposal' });
  }

  if (taskState) {
    parts.push({
      task: taskState,
      type: 'task-state'
    });
  }

  for (const proposal of tagProposals) {
    parts.push({ proposal, type: 'tag-proposal' });
  }

  return parts;
}

export function buildConversationMemory(
  messages: ConversationMessage[]
): AssistantConversationMemory | null {
  const materialMessages = messages.filter((message) => !message.message_id.startsWith('client-'));
  if (materialMessages.length < 2) {
    return null;
  }

  const lastUserMessage = [...materialMessages]
    .reverse()
    .find((message) => message.role === 'user' && message.content.trim());
  const sources = uniqueSourceLinks(
    materialMessages.flatMap((message) =>
      message.source_links.length > 0
        ? message.source_links
        : sourceLinksFromParts(message.parts ?? [])
    )
  );
  const pendingNoteProposalCount = materialMessages
    .flatMap((message) => noteProposalsFromMessage(message))
    .filter((proposal) => proposal.status === 'pending' || proposal.status === 'applying').length;
  const pendingEntryMetaProposalCount = materialMessages
    .flatMap((message) =>
      (message.parts ?? []).flatMap((part) =>
        part.type === 'entry-meta-proposal' ? [part.proposal] : []
      )
    )
    .filter((proposal) => proposal.status === 'pending' || proposal.status === 'applying').length;
  const pendingProposalCount = pendingNoteProposalCount + pendingEntryMetaProposalCount;
  const recentGoals = materialMessages
    .filter((message) => message.role === 'user' && message.content.trim())
    .slice(-3)
    .map((message) => compactMemoryText(message.content, 72));
  const openItems = [
    ...latestConversationContextItemsFromMessages(materialMessages)
      .slice(0, 3)
      .map(contextItemLabel),
    sources.length > 0 ? `${sources.length} cited source${sources.length === 1 ? '' : 's'}` : null,
    pendingProposalCount > 0
      ? `${pendingProposalCount} pending proposal${pendingProposalCount === 1 ? '' : 's'}`
      : null
  ].filter((item): item is string => Boolean(item));

  return {
    last_user_goal: lastUserMessage ? compactMemoryText(lastUserMessage.content, 160) : null,
    message_count: materialMessages.length,
    open_items: openItems,
    pending_proposal_count: pendingProposalCount,
    source_count: sources.length,
    summary:
      recentGoals.length > 0
        ? recentGoals.join(' / ')
        : `${materialMessages.length} messages in this conversation`,
    updated_at: new Date().toISOString()
  };
}

export function analyzeConversationLength(
  messages: ConversationMessage[],
  selectedProfile: LlmProfile | null
) {
  const materialMessages = messages.filter((message) => !message.message_id.startsWith('client-'));
  const charCount = materialMessages.reduce(
    (total, message) => total + estimateMessageChars(message),
    0
  );
  const estimatedTokens = estimateTokensFromChars(charCount);
  const modelTokens = modelContextTokens(selectedProfile?.max_context_length);
  const usageRatio = estimatedTokens / modelTokens;
  const memoryActive = materialMessages.some((message) =>
    (message.parts ?? []).some((part) => part.type === 'memory')
  );

  return {
    charCount,
    isLong: usageRatio >= CONTEXT_WARNING_RATIO && estimatedTokens >= CONTEXT_WARNING_MIN_TOKENS,
    kiloChars: Math.max(1, Math.round(charCount / 1000)),
    kiloTokens: Math.max(1, Math.round(estimatedTokens / 1000)),
    memoryActive,
    modelKiloTokens: Math.max(1, Math.round(modelTokens / 1000)),
    messageCount: materialMessages.length
  };
}

export function estimateMessageChars(message: ConversationMessage) {
  const contentChars = message.content.length;
  const partChars = (message.parts ?? []).reduce(
    (total, part) => total + estimatePartChars(part),
    0
  );
  return Math.max(contentChars, partChars);
}

export function estimatePartChars(part: AssistantMessagePart) {
  if (part.type === 'text') {
    return part.markdown.length;
  }
  if (part.type === 'tool-result') {
    return part.summary.length + (part.sourceLinks?.length ?? 0) * 160;
  }
  if (part.type === 'tool-call') {
    return part.toolName.length + 80;
  }
  if (part.type === 'source') {
    return 160;
  }
  if (part.type === 'context') {
    return part.items.length * 120;
  }
  if (part.type === 'context-snapshot') {
    return part.items.length * 160 + (part.plan ? JSON.stringify(part.plan).length : 0);
  }
  if (part.type === 'note-proposal') {
    return part.proposal.markdown.length + part.proposal.title.length;
  }
  if (part.type === 'entry-meta-proposal') {
    return (
      part.proposal.beforeTitle.length +
      part.proposal.afterTitle.length +
      part.proposal.beforeDescription.length +
      part.proposal.afterDescription.length +
      (part.proposal.rationale?.length ?? 0)
    );
  }
  if (part.type === 'memory') {
    return JSON.stringify(part.memory).length;
  }
  if (part.type === 'plan') {
    return part.plan.rationale.length + part.plan.missing.join(' ').length + 160;
  }
  if (part.type === 'task-state') {
    return JSON.stringify(part.task).length;
  }
  if (part.type === 'error') {
    return part.message.length;
  }
  return 0;
}

export function uniqueSourceLinks(sources: ConversationSourceLink[]) {
  const seen = new Set<string>();
  const unique: ConversationSourceLink[] = [];
  for (const source of sources) {
    const key = `${source.entry_id}:${source.segment_uid}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(source);
  }
  return unique;
}

export function sourceLinksFromParts(parts: AssistantMessagePart[]) {
  return parts
    .filter(
      (part): part is Extract<AssistantMessagePart, { type: 'source' }> => part.type === 'source'
    )
    .map((part) => part.source);
}

export function contextItemsFromParts(parts: AssistantMessagePart[]) {
  const snapshot = parts.find(
    (part): part is Extract<AssistantMessagePart, { type: 'context-snapshot' }> =>
      part.type === 'context-snapshot'
  );
  if (snapshot) {
    return snapshot.items;
  }
  return (
    parts.find(
      (part): part is Extract<AssistantMessagePart, { type: 'context' }> => part.type === 'context'
    )?.items ?? []
  );
}

export function latestConversationContextItems(conversation: Conversation) {
  return latestConversationContextItemsFromMessages(conversation.messages);
}

export function latestConversationContextItemsFromMessages(messages: ConversationMessage[]) {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') {
      continue;
    }
    const items = contextItemsFromParts(message.parts ?? []);
    if (items.length > 0) {
      return cloneAssistantContextItems(items);
    }
  }
  return [];
}

export function cloneAssistantContextItems(items: AssistantContextItem[]) {
  return items.map((item) => ({ ...item }));
}

export function contextItemToInput(item: AssistantContextItem): AssistantContextInput {
  if (item.kind === 'segment') {
    return {
      id: item.id,
      entryId: item.entryId,
      entryTitle: item.entryTitle,
      kind: 'segment',
      pageIdx: item.pageIdx,
      segmentUid: item.segmentUid,
      text: item.text
    };
  }

  return {
    id: item.id,
    contentId: item.contentId,
    contentKind: item.contentKind,
    contentTitle: item.contentTitle,
    entryId: item.entryId,
    entryTitle: item.entryTitle,
    kind: 'entry'
  };
}

export function contextTargetToInput(target: EntryContextTarget): AssistantContextInput {
  const contentKind = target.contentKind ?? 'entry';
  return {
    id: targetContextItemId(target),
    contentId: contentKind === 'entry' ? undefined : target.contentId,
    contentKind: contentKind === 'entry' ? undefined : contentKind,
    contentTitle: contentKind === 'entry' ? undefined : target.contentTitle,
    entryId: target.entry.id,
    entryTitle: target.entry.title,
    kind: 'entry'
  };
}

export function assistantContextInputToItem(input: AssistantContextInput): AssistantContextItem {
  return {
    ...input,
    id:
      input.id ??
      (input.kind === 'segment'
        ? `segment:${input.entryId}:${input.segmentUid}`
        : `entry:${input.entryId}${
            input.contentKind && input.contentKind !== 'entry'
              ? `:${input.contentKind}:${input.contentId ?? input.contentKind}`
              : ''
          }`),
    addedAt: new Date().toISOString()
  } as AssistantContextItem;
}

export function upsertAssistantContextTarget(items: AssistantContextItem[], target: EntryContextTarget) {
  const input = contextTargetToInput(target);
  const item = assistantContextInputToItem(input);
  const exists = items.some((contextItem) => contextItem.id === item.id);
  if (exists) {
    return items;
  }

  return [
    ...items.filter(
      (contextItem) =>
        !(
          item.kind === 'entry' &&
          item.contentKind &&
          item.contentKind !== 'entry' &&
          contextItem.kind === 'entry' &&
          contextItem.entryId === item.entryId &&
          !contextItem.contentKind
        )
    ),
    item
  ];
}

export function compactMemoryText(text: string, maxLength: number) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact;
}

export function patchConversationNoteProposal(
  conversation: Conversation,
  proposalId: string,
  patch: Partial<AssistantNoteProposal>
) {
  let patchedMessage: ConversationMessage | null = null;
  const messages = conversation.messages.map((message) => {
    const proposals = noteProposalsFromMessage(message);
    const hasProposal = proposals.some((proposal) => proposal.id === proposalId);
    const hasProposalPart = (message.parts ?? []).some(
      (part) => part.type === 'note-proposal' && part.proposal.id === proposalId
    );

    if (!hasProposal && !hasProposalPart) {
      return message;
    }

    const nextProposals = updateNoteProposalList(proposals, proposalId, patch);
    const nextMessage = {
      ...message,
      note_proposals: nextProposals,
      parts: updateNoteProposalParts(message.parts ?? [], proposalId, patch)
    };
    patchedMessage = nextMessage;
    return nextMessage;
  });

  if (!patchedMessage) {
    return null;
  }

  return {
    conversation: {
      ...conversation,
      messages
    },
    message: patchedMessage
  };
}

export function noteProposalsFromMessage(message: ConversationMessage) {
  if (message.note_proposals && message.note_proposals.length > 0) {
    return message.note_proposals;
  }

  return (message.parts ?? [])
    .filter(
      (part): part is Extract<AssistantMessagePart, { type: 'note-proposal' }> =>
        part.type === 'note-proposal'
    )
    .map((part) => part.proposal);
}

export function updateNoteProposalParts(
  parts: AssistantMessagePart[],
  proposalId: string,
  patch: Partial<AssistantNoteProposal>
) {
  const proposal = parts.find(
    (part): part is Extract<AssistantMessagePart, { type: 'note-proposal' }> =>
      part.type === 'note-proposal' && part.proposal.id === proposalId
  )?.proposal;
  const taskId = proposal?.taskId;
  return parts.map((part) => {
    if (part.type === 'note-proposal' && part.proposal.id === proposalId) {
      return {
        ...part,
        proposal: { ...part.proposal, ...patch }
      };
    }
    if (part.type !== 'task-state' || !taskId || part.task.taskId !== taskId) {
      return part;
    }
    const status =
      patch.status === 'applied'
        ? 'completed'
        : patch.status === 'rejected'
          ? 'cancelled'
          : part.task.status;
    return {
      ...part,
      task: {
        ...part.task,
        phase:
          patch.status === 'applying' || patch.status === 'applied' ? 'apply' : part.task.phase,
        revision: part.task.revision + 1,
        status,
        updatedAt: new Date().toISOString()
      }
    };
  });
}

export function mergeToolTraceEvent(events: AssistantToolTraceEvent[], event: AssistantToolTraceEvent) {
  const index = events.findIndex((current) => current.id === event.id);
  if (index < 0) {
    return [...events, event];
  }

  return events.map((current, currentIndex) =>
    currentIndex === index
      ? {
          ...current,
          ...event
        }
      : current
  );
}

export function mergeNoteProposal(proposals: AssistantNoteProposal[], proposal: AssistantNoteProposal) {
  const index = proposals.findIndex((current) => current.id === proposal.id);
  if (index < 0) {
    return [...proposals, proposal];
  }

  return proposals.map((current, currentIndex) =>
    currentIndex === index ? { ...current, ...proposal } : current
  );
}

export function updateNoteProposalList(
  proposals: AssistantNoteProposal[],
  proposalId: string,
  patch: Partial<AssistantNoteProposal>
) {
  return proposals.map((proposal) =>
    proposal.id === proposalId ? { ...proposal, ...patch } : proposal
  );
}

export function patchMessageTagProposal(
  message: ConversationMessage,
  proposalId: string,
  patch: Partial<AssistantTagProposal>
) {
  let changed = false;
  const parts = (message.parts ?? []).map((part) => {
    if (part.type !== 'tag-proposal' || part.proposal.id !== proposalId) return part;
    changed = true;
    return {
      ...part,
      proposal: { ...part.proposal, ...patch }
    } satisfies AssistantMessagePart;
  });
  return changed ? { ...message, parts } : message;
}

export function patchMessageEntryMetaProposal(
  message: ConversationMessage,
  proposalId: string,
  patch: Partial<AssistantEntryMetaProposal>
) {
  let changed = false;
  const parts = (message.parts ?? []).map((part) => {
    if (part.type !== 'entry-meta-proposal' || part.proposal.id !== proposalId) return part;
    changed = true;
    return {
      ...part,
      proposal: { ...part.proposal, ...patch }
    } satisfies AssistantMessagePart;
  });
  return changed ? { ...message, parts } : message;
}

export function rebaseProposalQuestion(proposal: AssistantNoteProposal) {
  const target = proposal.noteTitle ?? proposal.title;
  const operation = proposal.action === 'append'
    ? '追加'
    : proposal.action === 'prepend'
      ? '前置追加'
    : proposal.action === 'delete'
      ? '删除指定内容'
      : proposal.action === 'replace'
        ? '替换'
        : '完善';
  return [
    `请重新读取 @${target} 的最新完整内容，基于当前版本重新生成${operation} Diff。`,
    '保持原提案的修改意图，不要直接写入。目标内容如下：',
    proposal.markdown
  ].join('\n\n');
}

