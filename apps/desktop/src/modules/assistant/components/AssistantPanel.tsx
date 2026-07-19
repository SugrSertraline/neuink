import {
  Archive,
  History,
  Info,
  MessageSquarePlus,
  Send,
  Square,
  Settings
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import {
  deleteAgentRun,
  deleteConversation,
  getCachedConversations,
  getLlmSettings,
  listAgentRuns,
  listConversations,
  loadConversation,
  renameConversation,
  setTaskLlmProfile,
  subscribeLlmSettings,
  updateConversationMessage,
  type AssistantToolTraceEvent,
  type Conversation,
  type ConversationMessage,
  type ConversationMeta,
  type ConversationSourceLink,
  type LlmProfile
} from '@/shared/ipc/assistantApi';
import type {
  AssistantActiveNote,
  AssistantActiveSegment,
  AssistantComposerSnapshot,
  AssistantContext,
  AssistantContextInput,
  AssistantEntryMetaProposal,
  AssistantNoteProposal,
  AssistantTagProposal
} from '@/shared/types/assistant';
import type { TagMeta } from '@/shared/types/domain';
import { useToast } from '@/shared/hooks/useToast';

import { AssistantRunStatus } from './AssistantRunStatus';
import {
  AssistantConversationHistory,
  AssistantMessageList
} from './assistantPanelViews';
import { AssistantExternalContextItems } from './AssistantExternalContextItems';
import {
  getAssistantBackgroundRun,
  runAssistantPanelTask,
  setAssistantBackgroundRun,
  subscribeAssistantBackgroundRun,
  type QueuedAssistantDraft
} from './assistantRunController';
import {
  AssistantComposerEditor,
  type AssistantComposerDraft
} from './AssistantComposerEditor';
import { visibleConversationHistory } from './conversationHistory';
import { useAssistantAutoScroll } from './useAssistantAutoScroll';
import { buildAssistantScope } from './assistantScope';
import {
  externalAssistantContextItems,
  hasPersistableAssistantContext,
  orderedAssistantContextItems
} from './assistantComposerBlocks';
import {
  entryMarkdownTargets,
  scopeLabel
} from './assistantContextTargets';
import { planAssistantContext } from '../harness/contextPlanner';
import {
  analyzeConversationLength,
  buildConversationMemory,
  cloneAssistantContextItems,
  contextItemToInput,
  patchConversationNoteProposal,
  patchMessageEntryMetaProposal,
  patchMessageTagProposal,
  rebaseProposalQuestion,
  updateNoteProposalList,
  upsertAssistantContextTarget,
  useStableEvent
} from './assistantPanelState';

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

const INITIAL_MESSAGE_RENDER_LIMIT = 30;
export function AssistantPanel({
  activeEntry,
  activeTag,
  assistantContext,
  composerDraft,
  activeNote,
  activeSegment,
  draftQuestion,
  entries,
  root,
  status,
  tags,
  onClearAssistantContext,
  onComposerDraftChange,
  onCreateAssistantEntry,
  onAddAssistantContext,
  onApplyNoteProposal,
  onApplyEntryMetaProposal,
  onApplyTagProposal,
  onDraftQuestionConsumed,
  onExportConversation,
  onOpenSettings,
  onOpenSource,
  onReplaceAssistantContext,
  onRemoveAssistantContextItem
}: AssistantPanelProps) {
  const { notify } = useToast();
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [messageRenderLimit, setMessageRenderLimit] = useState(INITIAL_MESSAGE_RENDER_LIMIT);
  const [composerResetKey, setComposerResetKey] = useState(0);
  const [composerSnapshot, setComposerSnapshot] = useState<AssistantComposerSnapshot>(() =>
    composerDraft
      ? {
          mentions: composerDraft.snapshot.mentions.map((mention) => ({ ...mention })),
          text: composerDraft.snapshot.text
        }
      : { mentions: [], text: '' }
  );
  const [composerPrefill, setComposerPrefill] = useState<string | null>(null);
  const [queuedDraft, setQueuedDraft] = useState<QueuedAssistantDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<ConversationMessage[]>([]);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [toolEventsByMessageId, setToolEventsByMessageId] = useState<
    Record<string, AssistantToolTraceEvent[]>
  >({});
  const [noteProposalsByMessageId, setNoteProposalsByMessageId] = useState<
    Record<string, AssistantNoteProposal[]>
  >({});
  const runAbortControllerRef = useRef<AbortController | null>(null);

  const selectedTagIds = useMemo(
    () =>
      composerSnapshot.mentions
        .filter((mention) => mention.kind === 'tag' && mention.tagId)
        .map((mention) => mention.tagId as string),
    [composerSnapshot.mentions]
  );
  const scope = useMemo(
    () => buildAssistantScope({ activeEntry, activeTag, entries, selectedTagIds, tags }),
    [activeEntry, activeTag, entries, selectedTagIds, tags]
  );
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );
  const visibleMessages = useMemo(
    () => [...(conversation?.messages ?? []), ...optimisticMessages],
    [conversation?.messages, optimisticMessages]
  );
  const visibleConversations = useMemo(
    () => visibleConversationHistory(conversations),
    [conversations]
  );
  const renderedMessages = useMemo(
    () => visibleMessages.slice(-messageRenderLimit),
    [messageRenderLimit, visibleMessages]
  );
  const hiddenMessageCount = visibleMessages.length - renderedMessages.length;
  const runStatusToolEvents = useMemo(
    () =>
      visibleMessages.flatMap(
        (message) => toolEventsByMessageId[message.message_id] ?? message.tool_events ?? []
      ),
    [toolEventsByMessageId, visibleMessages]
  );
  const scrollContentVersion = useMemo(() => {
    const latest = visibleMessages[visibleMessages.length - 1];
    const latestEvents = latest
      ? (toolEventsByMessageId[latest.message_id] ?? latest.tool_events ?? [])
      : [];
    const proposals = latest
      ? (noteProposalsByMessageId[latest.message_id] ?? latest.note_proposals ?? [])
      : [];
    return [
      visibleMessages.length,
      latest?.message_id ?? '',
      latest?.content.length ?? 0,
      latestEvents
        .map((event) => `${event.id}:${event.status}:${event.summary?.length ?? 0}`)
        .join(','),
      proposals.map((proposal) => `${proposal.id}:${proposal.status}`).join(','),
      streamingMessageId ?? ''
    ].join('|');
  }, [noteProposalsByMessageId, streamingMessageId, toolEventsByMessageId, visibleMessages]);
  const {
    containerRef: messagesScrollRef,
    contentRef: messagesContentRef,
    endRef: messagesEndRef,
    forceNextScroll,
    handleScroll: handleMessagesScroll,
    isAtBottom: messagesAtBottom
  } = useAssistantAutoScroll({
    contentVersion: scrollContentVersion,
    conversationId: conversation?.id
  });
  const conversationMemory = useMemo(
    () => buildConversationMemory(visibleMessages),
    [visibleMessages]
  );
  const longConversation = useMemo(
    () => analyzeConversationLength(visibleMessages, selectedProfile),
    [selectedProfile, visibleMessages]
  );
  const question = composerSnapshot.text;
  const selectableContextEntries = useMemo(
    () => [...entries].sort((left, right) => left.title.localeCompare(right.title)),
    [entries]
  );
  const externalContextItems = useMemo(() => {
    return externalAssistantContextItems(assistantContext.items, composerSnapshot);
  }, [assistantContext.items, composerSnapshot.mentions]);
  const composerDisabled = !root || !selectedProfile;

  useEffect(() => {
    setMessageRenderLimit(INITIAL_MESSAGE_RENDER_LIMIT);
  }, [conversation?.id]);

  useEffect(() => {
    let cancelled = false;
    let publishedVersion = 0;
    const applySettings = (settingsState: Awaited<ReturnType<typeof getLlmSettings>>) => {
      if (cancelled) {
        return;
      }
      setProfiles(settingsState.profiles);
      setSelectedProfileId(
        settingsState.assistant_profile_id
      );
    };
    const unsubscribe = subscribeLlmSettings((settingsState) => {
      publishedVersion += 1;
      applySettings(settingsState);
    });
    const requestVersion = publishedVersion;
    void getLlmSettings().then((settingsState) => {
      if (cancelled || publishedVersion !== requestVersion) {
        return;
      }
      applySettings(settingsState);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const syncBackgroundRun = () => {
      const run = getAssistantBackgroundRun();
      if (!run) {
        setBusy(false);
        setStreamingMessageId(null);
        runAbortControllerRef.current = null;
        return;
      }
      if (run.root !== root) {
        return;
      }
      setBusy(true);
      setError(run.error);
      setConversation(run.conversation);
      setOptimisticMessages([]);
      setStreamingMessageId(run.streamingMessageId);
      setToolEventsByMessageId(run.toolEventsByMessageId);
      setNoteProposalsByMessageId(run.noteProposalsByMessageId);
      runAbortControllerRef.current = run.abortController;
    };

    syncBackgroundRun();
    return subscribeAssistantBackgroundRun(syncBackgroundRun);
  }, [root]);

  useEffect(() => {
    if (!root || status !== 'ready') {
      setConversations([]);
      return;
    }
    let cancelled = false;
    void listConversations(root)
      .then((items) => {
        if (!cancelled) {
          setConversations(items);
          setHistoryError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setHistoryError(caught instanceof Error ? caught.message : String(caught));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root, status]);

  useEffect(() => {
    if (busy || !queuedDraft) {
      return;
    }
    const draft = queuedDraft;
    setQueuedDraft(null);
    void send(draft);
  }, [busy, queuedDraft]);

  const send = async (queued?: QueuedAssistantDraft) => {
    const trimmed = (queued?.question ?? question).trim();
    if (!root || !selectedProfile || !trimmed) {
      return;
    }
    if (busy && !queued) {
      const snapshot: AssistantComposerSnapshot = {
        mentions: composerSnapshot.mentions.map((mention) => ({ ...mention })),
        text: composerSnapshot.text
      };
      const contextItems = orderedAssistantContextItems(assistantContext.items, snapshot);
      setQueuedDraft({
        activeEntry: activeEntry ? { id: activeEntry.id, title: activeEntry.title } : null,
        activeNote: activeNote ? { ...activeNote } : null,
        activeSegment: activeSegment ? { ...activeSegment } : null,
        contextItems,
        contextPlan: planAssistantContext({
          composerSnapshot: snapshot,
          items: contextItems,
          question: trimmed
        }),
        question: trimmed,
        snapshot
      });
      setComposerResetKey((key) => key + 1);
      return;
    }
    const submittedComposerSnapshot: AssistantComposerSnapshot = queued
      ? {
          mentions: queued.snapshot.mentions.map((mention) => ({ ...mention })),
          text: queued.snapshot.text
        }
      : {
          mentions: composerSnapshot.mentions.map((mention) => ({
            ...mention
          })),
          text: composerSnapshot.text
        };
    const messageContextItems = queued
      ? cloneAssistantContextItems(queued.contextItems)
      : orderedAssistantContextItems(assistantContext.items, submittedComposerSnapshot);
    const submittedContextPlan =
      queued?.contextPlan ??
      planAssistantContext({
        composerSnapshot: submittedComposerSnapshot,
        items: messageContextItems,
        question: trimmed
      });
    const runEntry = queued
      ? queued.activeEntry
      : activeEntry
        ? { id: activeEntry.id, title: activeEntry.title }
        : null;
    const runNote = queued ? queued.activeNote : activeNote;
    const runSegment = queued ? queued.activeSegment : activeSegment;
    await runAssistantPanelTask({
      conversation,
      entries,
      forceNextScroll,
      messageContextItems,
      noteProposalsByMessageId,
      onAddAssistantContext,
      onCreateAssistantEntry,
      profiles,
      resetComposer: !queued,
      root,
      runAbortControllerRef,
      runEntry,
      runNote,
      runSegment,
      scope,
      selectedProfile,
      setBusy,
      setComposerResetKey,
      setConversation,
      setConversations,
      setError,
      setHistoryOpen,
      setNoteProposalsByMessageId,
      setOptimisticMessages,
      setStreamingMessageId,
      setToolEventsByMessageId,
      submittedComposerSnapshot,
      submittedContextPlan,
      tags,
      toolEventsByMessageId,
      trimmedQuestion: trimmed
    });
  };

  const cancelRun = () => {
    runAbortControllerRef.current?.abort();
  };

  const retryAgentRun = (retryQuestion: string) => {
    const nextQuestion = retryQuestion.trim();
    if (!nextQuestion || busy) {
      return;
    }
    setComposerPrefill(nextQuestion);
    setError(null);
  };

  const regenerateNoteProposal = (proposal: AssistantNoteProposal) => {
    const entry = entries.find((candidate) => candidate.id === proposal.entryId);
    const target = entry && proposal.noteId
      ? entryMarkdownTargets(entry).find((candidate) => candidate.contentId === proposal.noteId)
      : null;
    if (target) {
      onReplaceAssistantContext(
        upsertAssistantContextTarget(assistantContext.items, target).map(contextItemToInput)
      );
    }
    retryAgentRun(rebaseProposalQuestion(proposal));
  };

  const selectProfile = async (profileId: string) => {
    setSelectedProfileId(profileId);
    try {
      const settingsState = await setTaskLlmProfile('assistant', profileId);
      setProfiles(settingsState.profiles);
      setSelectedProfileId(settingsState.assistant_profile_id ?? profileId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const openConversation = async (conversationId: string) => {
    if (!root) {
      return;
    }
    setBusy(true);
    setError(null);
    setOptimisticMessages([]);
    setStreamingMessageId(null);
    setToolEventsByMessageId({});
    setNoteProposalsByMessageId({});
    try {
      const loaded = await loadConversation(root, conversationId);
      setConversation(loaded);
      setHistoryOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggleConversationHistory = async () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }

    setHistoryOpen(true);
    if (!root || status !== 'ready') {
      return;
    }

    const cached = getCachedConversations(root);
    if (cached) {
      setConversations(cached);
    }
    setHistoryLoading(!cached);
    setHistoryError(null);
    try {
      setConversations(await listConversations(root));
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setHistoryLoading(false);
    }
  };

  const deleteConversationHistory = async (item: ConversationMeta) => {
    if (!root || busy) {
      return;
    }

    const confirmed = window.confirm(`确定要删除对话“${item.title}”吗？此操作不可撤销。`);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const linkedRuns = await listAgentRuns(root, {
        conversationId: item.id,
        limit: 100
      });
      await deleteConversation(root, item.id);
      await Promise.all(
        linkedRuns.map((run) => deleteAgentRun(root, run.runId).catch(() => undefined))
      );
      if (conversation?.id === item.id) {
        setConversation(null);
        setOptimisticMessages([]);
        setStreamingMessageId(null);
        setToolEventsByMessageId({});
        setNoteProposalsByMessageId({});
      }
      setConversations((current) => current.filter((conversation) => conversation.id !== item.id));
      setConversations(await listConversations(root));
      notify({
        description: item.title,
        title: '对话已删除',
        tone: 'success'
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      notify({
        description: message,
        title: '删除失败',
        tone: 'danger'
      });
    } finally {
      setBusy(false);
    }
  };

  const renameConversationHistory = async (item: ConversationMeta) => {
    if (!root || busy) {
      return;
    }

    const title = window.prompt('重命名对话', item.title)?.trim();
    if (!title || title === item.title) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const renamed = await renameConversation(root, item.id, title);
      if (conversation?.id === renamed.id) {
        setConversation(renamed);
      }
      setConversations(await listConversations(root));
      notify({
        description: renamed.title,
        title: '对话已重命名',
        tone: 'success'
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      notify({
        description: message,
        title: '重命名失败',
        tone: 'danger'
      });
    } finally {
      setBusy(false);
    }
  };

  const exportConversationHistory = async (item: ConversationMeta) => {
    if (!root || busy) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const target =
        conversation?.id === item.id ? conversation : await loadConversation(root, item.id);
      await onExportConversation(target);
      notify({
        description: target.title,
        title: '对话已导出为笔记',
        tone: 'success'
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      notify({
        description: message,
        title: '导出失败',
        tone: 'danger'
      });
    } finally {
      setBusy(false);
    }
  };

  const exportCurrentConversation = async () => {
    if (!conversation || busy) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onExportConversation(conversation);
      notify({
        description: conversation.title,
        title: '对话已导出为笔记',
        tone: 'success'
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      notify({
        description: message,
        title: '导出失败',
        tone: 'danger'
      });
    } finally {
      setBusy(false);
    }
  };

  const startNewConversation = () => {
    setConversation(null);
    setOptimisticMessages([]);
    setStreamingMessageId(null);
    setToolEventsByMessageId({});
    setNoteProposalsByMessageId({});
    onClearAssistantContext();
    setHistoryOpen(false);
  };

  const applyNoteProposal = async (proposal: AssistantNoteProposal) => {
    updateNoteProposalStatus(proposal.id, {
      error: undefined,
      status: 'applying'
    });

    try {
      const appliedProposal = await onApplyNoteProposal(proposal);
      const updatedMessage = updateNoteProposalStatus(proposal.id, {
        ...appliedProposal,
        appliedAt: new Date().toISOString(),
        status: 'applied'
      });
      void persistUpdatedConversationMessage(updatedMessage);
    } catch (caught) {
      const updatedMessage = updateNoteProposalStatus(proposal.id, {
        error: caught instanceof Error ? caught.message : String(caught),
        status: 'error'
      });
      void persistUpdatedConversationMessage(updatedMessage);
    }
  };

  const rejectNoteProposal = (proposal: AssistantNoteProposal) => {
    const updatedMessage = updateNoteProposalStatus(proposal.id, {
      status: 'rejected'
    });
    void persistUpdatedConversationMessage(updatedMessage);
  };

  const applyTagProposal = async (proposal: AssistantTagProposal) => {
    updateTagProposalStatus(proposal.id, {
      error: undefined,
      status: 'applying'
    });
    try {
      await onApplyTagProposal(proposal);
      const updated = updateTagProposalStatus(proposal.id, {
        appliedAt: new Date().toISOString(),
        status: 'applied'
      });
      void persistUpdatedConversationMessage(updated);
    } catch (caught) {
      const updated = updateTagProposalStatus(proposal.id, {
        error: caught instanceof Error ? caught.message : String(caught),
        status: 'error'
      });
      void persistUpdatedConversationMessage(updated);
    }
  };

  const applyEntryMetaProposal = async (proposal: AssistantEntryMetaProposal) => {
    updateEntryMetaProposalStatus(proposal.id, { error: undefined, status: 'applying' });
    try {
      await onApplyEntryMetaProposal(proposal);
      const updated = updateEntryMetaProposalStatus(proposal.id, {
        appliedAt: new Date().toISOString(),
        status: 'applied'
      });
      void persistUpdatedConversationMessage(updated);
    } catch (caught) {
      const updated = updateEntryMetaProposalStatus(proposal.id, {
        error: caught instanceof Error ? caught.message : String(caught),
        status: 'error'
      });
      void persistUpdatedConversationMessage(updated);
    }
  };

  const rejectEntryMetaProposal = (proposal: AssistantEntryMetaProposal) => {
    const updated = updateEntryMetaProposalStatus(proposal.id, { status: 'rejected' });
    void persistUpdatedConversationMessage(updated);
  };

  const updateEntryMetaProposalStatus = (
    proposalId: string,
    patch: Partial<AssistantEntryMetaProposal>
  ) => {
    const sourceConversation = conversation;
    if (!sourceConversation) return null;
    let updatedMessage: ConversationMessage | null = null;
    const nextConversation = {
      ...sourceConversation,
      messages: sourceConversation.messages.map((message) => {
        const next = patchMessageEntryMetaProposal(message, proposalId, patch);
        if (next !== message) updatedMessage = next;
        return next;
      })
    };
    if (!updatedMessage) return null;
    setConversation(nextConversation);
    return { conversationId: nextConversation.id, message: updatedMessage };
  };

  const rejectTagProposal = (proposal: AssistantTagProposal) => {
    const updated = updateTagProposalStatus(proposal.id, {
      status: 'rejected'
    });
    void persistUpdatedConversationMessage(updated);
  };

  const updateTagProposalStatus = (proposalId: string, patch: Partial<AssistantTagProposal>) => {
    const sourceConversation = conversation;
    if (!sourceConversation) return null;
    let updatedMessage: ConversationMessage | null = null;
    const nextConversation = {
      ...sourceConversation,
      messages: sourceConversation.messages.map((message) => {
        const next = patchMessageTagProposal(message, proposalId, patch);
        if (next !== message) updatedMessage = next;
        return next;
      })
    };
    if (!updatedMessage) return null;
    setConversation(nextConversation);
    return { conversationId: nextConversation.id, message: updatedMessage };
  };

  const updateNoteProposalStatus = (proposalId: string, patch: Partial<AssistantNoteProposal>) => {
    const conversationPatch = conversation
      ? patchConversationNoteProposal(conversation, proposalId, patch)
      : null;

    setNoteProposalsByMessageId((current) =>
      Object.fromEntries(
        Object.entries(current).map(([messageId, proposals]) => [
          messageId,
          updateNoteProposalList(proposals, proposalId, patch)
        ])
      )
    );
    setOptimisticMessages((messages) =>
      messages.map((message) => ({
        ...message,
        note_proposals: message.note_proposals
          ? updateNoteProposalList(message.note_proposals, proposalId, patch)
          : message.note_proposals
      }))
    );

    if (conversationPatch) {
      setConversation(conversationPatch.conversation);
      return {
        conversationId: conversationPatch.conversation.id,
        message: conversationPatch.message
      };
    }

    return null;
  };

  const persistUpdatedConversationMessage = async (
    updated: { conversationId: string; message: ConversationMessage } | null
  ) => {
    if (!root || !updated) {
      return;
    }

    try {
      const conversationState = await updateConversationMessage(
        root,
        updated.conversationId,
        updated.message.message_id,
        {
          content: updated.message.content,
          note_proposals: updated.message.note_proposals ?? [],
          parts: updated.message.parts ?? [],
          source_links: updated.message.source_links,
          tool_events: updated.message.tool_events ?? []
        }
      );
      setConversation((current) =>
        current?.id === conversationState.id ? conversationState : current
      );
      setConversations(await listConversations(root));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      notify({
        description: message,
        title: '无法保存对话状态',
        tone: 'danger'
      });
    }
  };

  const handleMessageApplyNoteProposal = useStableEvent((proposal: AssistantNoteProposal) => {
    void applyNoteProposal(proposal);
  });
  const handleMessageApplyEntryMetaProposal = useStableEvent(
    (proposal: AssistantEntryMetaProposal) => {
      void applyEntryMetaProposal(proposal);
    }
  );
  const handleMessageApplyTagProposal = useStableEvent((proposal: AssistantTagProposal) => {
    void applyTagProposal(proposal);
  });
  const handleMessageOpenSource = useStableEvent(onOpenSource);
  const handleMessageRejectNoteProposal = useStableEvent(rejectNoteProposal);
  const handleMessageRejectEntryMetaProposal = useStableEvent(rejectEntryMetaProposal);
  const handleMessageRejectTagProposal = useStableEvent(rejectTagProposal);
  const handleMessageRegenerateNoteProposal = useStableEvent(regenerateNoteProposal);
  const handleMessageRetryAgentRun = useStableEvent(retryAgentRun);

  return (
    <aside className="app-sidebar" data-assistant-context-dropzone="true">
      <div className="side-head min-w-0">
        <span className="min-w-0 truncate">Assistant</span>
        <AssistantRunStatus
          busy={busy}
          error={error}
          queued={Boolean(queuedDraft)}
          streaming={Boolean(streamingMessageId)}
          toolEvents={runStatusToolEvents}
        />
      </div>

      <div className="relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <div className="min-w-0 border-b p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{scopeLabel(scope)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon-sm"
                title="History"
                type="button"
                variant={historyOpen ? 'secondary' : 'ghost'}
                onClick={() => void toggleConversationHistory()}
              >
                <History />
              </Button>
              <Button
                size="icon-sm"
                title="New conversation"
                type="button"
                variant="ghost"
                onClick={startNewConversation}
              >
                <MessageSquarePlus />
              </Button>
              <Button
                size="icon-sm"
                title="Settings"
                type="button"
                variant="ghost"
                onClick={onOpenSettings}
              >
                <Settings />
              </Button>
            </div>
          </div>

          <div className="mt-2 min-w-0">
            <Select
              disabled={profiles.length === 0 || busy}
              value={selectedProfile?.id ?? ''}
              onValueChange={(value) => void selectProfile(value)}
            >
              <SelectTrigger className="w-full" size="sm">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name} · {profile.model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!selectedProfile ? (
            <div className="mt-2 rounded-md border bg-muted/30 p-2 text-xs leading-5 text-muted-foreground">
              Add an OpenAI-compatible model in Settings first.
            </div>
          ) : null}

          {error ? (
            <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/5 p-2 text-xs leading-5 text-destructive">
              {error}
            </div>
          ) : null}

          {conversationMemory && visibleMessages.length > 0 ? (
            <div className="mt-2 rounded-md border bg-muted/20 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
              <div className="flex min-w-0 items-center gap-1.5">
                <Info className="shrink-0" size={12} aria-hidden="true" />
                <span className="min-w-0 truncate">Memory: {conversationMemory.summary}</span>
              </div>
            </div>
          ) : null}

          <AssistantConversationHistory
            busy={busy}
            conversationId={conversation?.id ?? null}
            error={historyError}
            items={visibleConversations}
            loading={historyLoading}
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            onDelete={(item) => void deleteConversationHistory(item)}
            onExport={(item) => void exportConversationHistory(item)}
            onOpen={(conversationId) => void openConversation(conversationId)}
            onRename={(item) => void renameConversationHistory(item)}
          />
        </div>

        <AssistantMessageList
          contentRef={messagesContentRef}
          endRef={messagesEndRef}
          hiddenMessageCount={hiddenMessageCount}
          messageBatchSize={INITIAL_MESSAGE_RENDER_LIMIT}
          messagesAtBottom={messagesAtBottom}
          noteProposalsByMessageId={noteProposalsByMessageId}
          renderedMessages={renderedMessages}
          scrollRef={messagesScrollRef}
          streamingMessageId={streamingMessageId}
          toolEventsByMessageId={toolEventsByMessageId}
          visibleMessageCount={visibleMessages.length}
          onApplyEntryMetaProposal={handleMessageApplyEntryMetaProposal}
          onApplyNoteProposal={handleMessageApplyNoteProposal}
          onApplyTagProposal={handleMessageApplyTagProposal}
          onLoadEarlier={() =>
            setMessageRenderLimit((current) => current + INITIAL_MESSAGE_RENDER_LIMIT)
          }
          onOpenSource={handleMessageOpenSource}
          onRegenerateNoteProposal={handleMessageRegenerateNoteProposal}
          onRejectEntryMetaProposal={handleMessageRejectEntryMetaProposal}
          onRejectNoteProposal={handleMessageRejectNoteProposal}
          onRejectTagProposal={handleMessageRejectTagProposal}
          onRetryAgentRun={handleMessageRetryAgentRun}
          onReturnToLatest={forceNextScroll}
          onScroll={handleMessagesScroll}
        />

        <div className="min-w-0 border-t p-2">
          {longConversation.isLong ? (
            <div className="mb-2 min-w-0 rounded-md border border-warning-border bg-warning-surface p-2 text-xs leading-5 text-warning">
              <div className="flex min-w-0 gap-2">
                <Info className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Estimated context usage</div>
                  <div className="text-[11px] opacity-90">
                    About {longConversation.kiloTokens}k / {longConversation.modelKiloTokens}k
                    tokens ·{' '}
                    {longConversation.memoryActive ? 'memory active' : 'no memory snapshot yet'}.
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Button
                      disabled={!conversation || busy}
                      size="xs"
                      type="button"
                      variant="secondary"
                      onClick={() => void exportCurrentConversation()}
                    >
                      <Archive size={12} aria-hidden="true" />
                      Export
                    </Button>
                    <Button
                      disabled={busy}
                      size="xs"
                      type="button"
                      variant="ghost"
                      onClick={startNewConversation}
                    >
                      <MessageSquarePlus size={12} aria-hidden="true" />
                      New chat
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <AssistantExternalContextItems
            items={externalContextItems}
            onRemove={onRemoveAssistantContextItem}
          />

          <AssistantComposerEditor
            composerDraft={composerDraft}
            contextItems={assistantContext.items}
            disabled={composerDisabled}
            draftQuestion={composerPrefill ?? draftQuestion}
            entries={selectableContextEntries}
            tags={tags}
            resetKey={composerResetKey}
            onChange={(snapshot, contextItems, document) => {
              const previousInlineIds = new Set(
                composerSnapshot.mentions.map((mention) => mention.id)
              );
              const preservedExternalItems = assistantContext.items
                .filter((item) => !previousInlineIds.has(item.id))
                .map(contextItemToInput);
              setComposerSnapshot(snapshot);
              onComposerDraftChange(
                snapshot.text || snapshot.mentions.length > 0 ? { document, snapshot } : null
              );
              onReplaceAssistantContext([...preservedExternalItems, ...contextItems]);
            }}
            onDraftQuestionConsumed={() => {
              if (composerPrefill !== null) {
                setComposerPrefill(null);
              } else {
                onDraftQuestionConsumed();
              }
            }}
            onSubmit={() => void send()}
          />
          <div className="mt-2 flex justify-end gap-2">
            {busy ? (
              <>
                <Button size="sm" type="button" variant="outline" onClick={cancelRun}>
                  <Square />
                  Stop
                </Button>
                <Button
                  disabled={!selectedProfile || !question.trim() || Boolean(queuedDraft)}
                  size="sm"
                  type="button"
                  onClick={() => void send()}
                >
                  <Send />
                  {queuedDraft ? 'Queued' : 'Queue'}
                </Button>
              </>
            ) : (
              <Button
                disabled={!selectedProfile || !question.trim()}
                size="sm"
                type="button"
                onClick={() => void send()}
              >
                <Send />
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
