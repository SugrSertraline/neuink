import { useAppearance } from '@/shared/components/AppearanceProvider';
import { warmAssistantRouter } from '@/shared/ipc/assistantRoutingApi';
import { createApplicationActions } from '../runtime/applicationActions';
import { ExecutionRecovery } from './ExecutionRecovery';
import { ToolApprovalPanel } from './ToolApprovalPanel';
import { UserInputPanel } from './UserInputPanel';
import { getUserInputs, subscribeUserInputs } from '../runtime/userInput';
import { getToolApprovals, subscribeToolApprovals } from '../runtime/toolApproval';
import { decideStoredProposal } from '../review/decideStoredProposal';
import type { AssistantProposalConfirmation } from '@/shared/ipc/assistantProposalApi';
import { useNoteReviewBridge } from '../review/useNoteReviewBridge';
import { useNoteReviewActions } from '../review/useNoteReviewActions';
import { useNoteReview } from '../review/NoteReviewContext';
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
  useSyncExternalStore,
  useState
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
  type SciverseConversationSourceLink,
  type LlmProfile
} from '@/shared/ipc/assistantApi';
import { isSciverseConversationSource } from '@/shared/ipc/assistantApi';
import type {
  AssistantActiveNote,
  AssistantActiveSegment,
  AssistantActiveSurfaceSnapshot,
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
import { AssistantReadingContextControl } from './AssistantReadingContextControl';
import { resolveAssistantReadingContext, type AssistantReadingChoice } from './assistantReadingContext';
import { SciversePaperDetailDrawer } from '@/modules/sciverse/components/SciversePaperDetailDrawer';
import {
  getAssistantBackgroundRun,
  runAssistantPanelTask,
  subscribeAssistantBackgroundRun,
  type QueuedAssistantDraft
} from './assistantRunController';
import { findAssistantBackgroundRun, getAssistantBackgroundRuns, guardAssistantView, queueAssistantBackgroundRun, stopAssistantBackgroundRun, type AssistantBackgroundRunSnapshot } from './assistantBackgroundRuns';
import { AssistantBackgroundTasks } from './AssistantBackgroundTasks';
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
import { latestConversationMemory } from '../harness/conversationMemory';
import {
  analyzeConversationLength,
  cloneAssistantContextItems,
  contextItemToInput,
  patchConversationNoteProposal,
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
  activeSurface: AssistantActiveSurfaceSnapshot;
  draftQuestion: string | null;
  entries: LibraryEntry[];
  root: string | null;
  status: 'loading' | 'ready' | 'error';
  tags: TagMeta[];
  onClearAssistantContext: () => void;
  onComposerDraftChange: (draft: AssistantComposerDraft | null) => void;
  onCreateAssistantEntry: (title: string) => Promise<LibraryEntry>;
  onApplyNoteProposal: (proposal: AssistantNoteProposal) => Promise<AssistantNoteProposal>;
  onApplyEntryMetaProposal: (proposal: AssistantEntryMetaProposal, confirmation: AssistantProposalConfirmation) => Promise<void>;
  onApplyTagProposal: (proposal: AssistantTagProposal, confirmation: AssistantProposalConfirmation) => Promise<void>;
  onAddAssistantContext: (context: AssistantContextInput) => void;
  onDraftQuestionConsumed: () => void;
  onExportConversation: (conversation: Conversation) => Promise<void>;
  onOpenSettings: () => void;
  onOpenSource: (source: ConversationSourceLink) => void;
  onAddSciverseSource: (
    source: Extract<ConversationSourceLink, { provider: 'sciverse' }>
  ) => Promise<import('@/shared/ipc/assistantApi').SciverseLibraryImportResult>;
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
  activeSurface,
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
  onAddSciverseSource,
  onReplaceAssistantContext,
  onRemoveAssistantContextItem
}: AssistantPanelProps) {
  const { notify } = useToast();
  const { appearance, setAppearance } = useAppearance();
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const toolApprovals = useSyncExternalStore(subscribeToolApprovals, getToolApprovals);
  const awaitingApproval = toolApprovals.some(item => item.root === root && item.conversationId === conversation?.id);
  const awaitingUserInput = useSyncExternalStore(subscribeUserInputs,
    () => getUserInputs().some(item => item.root === root && item.conversationId === conversation?.id));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [conversationPendingDelete, setConversationPendingDelete] = useState<ConversationMeta | null>(null);
  const [conversationPendingRename, setConversationPendingRename] = useState<ConversationMeta | null>(null);
  const [conversationRenameValue, setConversationRenameValue] = useState('');
  const [sciverseDetailSource, setSciverseDetailSource] =
    useState<SciverseConversationSourceLink | null>(null);
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
  const [decidingProposal, setDecidingProposal] = useState<string | null>(null);
  const proposalDecisionLock = useRef(false);
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
  const viewRef = useRef({ generation: 0, conversationId: null as string | null });
  const [backgroundRuns, setBackgroundRuns] = useState<AssistantBackgroundRunSnapshot[]>([]);
  const previousRootRef = useRef(root);
  const currentRootRef = useRef(root);
  currentRootRef.current = root;
  const [readingChoice, setReadingChoice] = useState<{ root: string | null; value: AssistantReadingChoice }>({ root, value: null });
  const chosenReadingObject = readingChoice.root === root ? readingChoice.value : null;
  const readingContext = resolveAssistantReadingContext({ choice: chosenReadingObject, entries, items: assistantContext.items,
    activeEntry, activeNote, activeSegment, activeSurface });

  const selectedTagIds = useMemo(
    () =>
      composerSnapshot.mentions
        .filter((mention) => mention.kind === 'tag' && mention.tagId)
        .map((mention) => mention.tagId as string),
    [composerSnapshot.mentions]
  );
  const scope = useMemo(
    () => buildAssistantScope({ activeEntry: readingContext.entry, activeTag: readingContext.bound ? null : activeTag, entries, selectedTagIds, tags }),
    [readingContext.entry, readingContext.bound, activeTag, entries, selectedTagIds, tags]
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
    pauseAutoScroll,
    handleScroll: handleMessagesScroll,
    isAtBottom: messagesAtBottom
  } = useAssistantAutoScroll({
    contentVersion: scrollContentVersion,
    conversationId: conversation?.id
  });
  const conversationMemory = useMemo(
    () => latestConversationMemory(visibleMessages),
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
    if (root && selectedProfile) void warmAssistantRouter();
  }, [root, selectedProfile?.id]);

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
    let mounted = true;
    if (previousRootRef.current !== root) {
      previousRootRef.current = root;
      setConversation(null);
      setBusy(false);
      setError(null);
      setQueuedDraft(null);
      setOptimisticMessages([]);
      setStreamingMessageId(null);
      setToolEventsByMessageId({});
      setNoteProposalsByMessageId({});
    }
    const syncBackgroundRun = (finished?: AssistantBackgroundRunSnapshot) => {
      if (finished && finished.root === root) {
        if (finished.conversationId !== viewRef.current.conversationId &&
            (!finished.queuedDraft || finished.error || finished.abortController.signal.aborted)) {
          notify({ title: finished.abortController.signal.aborted ? '后台对话已停止' : finished.error ? '后台对话运行失败' : '后台对话已完成',
            description: finished.conversation?.title ?? finished.question,
            tone: finished.error && !finished.abortController.signal.aborted ? 'danger' : 'success' });
        }
        void listConversations(root).then(items => { if (mounted) setConversations(items); })
          .catch(() => { if (mounted) setHistoryError('聊天历史刷新失败，请重新打开历史记录。'); });
      }
      setBackgroundRuns(root ? getAssistantBackgroundRuns(root) : []);
      const run = root && viewRef.current.conversationId
        ? findAssistantBackgroundRun(root, viewRef.current.conversationId)
        : runAbortControllerRef.current ? getAssistantBackgroundRun(runAbortControllerRef.current) : null;
      if (!run) {
        if (runAbortControllerRef.current) {
          setBusy(false);
          setQueuedDraft(null);
          setStreamingMessageId(null);
          runAbortControllerRef.current = null;
        }
        return;
      }
      if (run.root !== root) {
        return;
      }
      setBusy(true);
      setError(run.error);
      setQueuedDraft(run.queuedDraft ?? null);
      viewRef.current.conversationId = run.conversationId;
      setConversation(run.conversation);
      setOptimisticMessages([]);
      setStreamingMessageId(run.streamingMessageId);
      setToolEventsByMessageId(run.toolEventsByMessageId);
      setNoteProposalsByMessageId(run.noteProposalsByMessageId);
      runAbortControllerRef.current = run.abortController;
    };

    syncBackgroundRun();
    const unsubscribe = subscribeAssistantBackgroundRun(syncBackgroundRun);
    return () => {
      mounted = false;
      unsubscribe();
      viewRef.current = { generation: viewRef.current.generation + 1, conversationId: null };
      runAbortControllerRef.current = null;
    };
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

  const send = async (queued?: QueuedAssistantDraft, resumeExecutionId?: string,
    continuedConversation?: Conversation, continuedGeneration?: number) => {
    const trimmed = resumeExecutionId ? '继续未完成任务' : (queued?.question ?? question).trim();
    if (!root || !selectedProfile || !trimmed) {
      return;
    }
    if (!queued && !resumeExecutionId && readingContext.unavailable) return;
    if (busy && !queued) {
      const snapshot: AssistantComposerSnapshot = {
        mentions: composerSnapshot.mentions.map((mention) => ({ ...mention })),
        text: composerSnapshot.text
      };
      const contextItems = orderedAssistantContextItems(assistantContext.items, snapshot);
      const draft: QueuedAssistantDraft = {
        activeEntry: readingContext.entry ? { id: readingContext.entry.id, title: readingContext.entry.title } : null,
        activeNote: readingContext.note ? { ...readingContext.note } : null,
        activeSegment: readingContext.segment ? { ...readingContext.segment } : null,
        activeSurface: { ...readingContext.surface, capturedAt: new Date().toISOString() },
        contextItems,
        contextPlan: planAssistantContext({
          composerSnapshot: snapshot,
          items: contextItems,
          question: trimmed
        }),
        question: trimmed,
        snapshot
      };
      const controller = runAbortControllerRef.current;
      const queuedGeneration = viewRef.current.generation;
      if (!controller || !queueAssistantBackgroundRun(controller, draft, latest => {
        void send(draft, undefined, latest, queuedGeneration);
      })) return;
      setQueuedDraft(draft);
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
      : readingContext.entry
        ? { id: readingContext.entry.id, title: readingContext.entry.title }
        : null;
    const runNote = queued ? queued.activeNote : readingContext.note;
    const runSegment = queued ? queued.activeSegment : readingContext.segment;
    const runSurface = queued
      ? queued.activeSurface
      : { ...readingContext.surface, capturedAt: new Date().toISOString() };
    const generation = continuedGeneration ?? viewRef.current.generation;
    const guard = <Args extends unknown[],>(callback: (...args: Args) => void) =>
      guardAssistantView(() => viewRef.current.generation === generation, callback);
    await runAssistantPanelTask({
      resumeExecutionId,
      applicationActions: createApplicationActions(appearance, setAppearance),
      conversation: continuedConversation ?? conversation,
      entries,
      forceNextScroll: guard(forceNextScroll),
      messageContextItems,
      noteProposalsByMessageId,
      onAddAssistantContext: guard(onAddAssistantContext),
      onCreateAssistantEntry,
      profiles,
      resetComposer: !queued && !resumeExecutionId,
      root,
      runAbortControllerRef: continuedConversation ? { current: null } : runAbortControllerRef,
      runEntry,
      runNote,
      runSegment,
      runSurface,
      scope,
      selectedProfile,
      setBusy: guard(setBusy),
      setComposerResetKey: guard(setComposerResetKey),
      setConversation: guard((update) => setConversation(current => {
        if (viewRef.current.generation !== generation) return current;
        const next = typeof update === 'function' ? update(current) : update;
        viewRef.current.conversationId = next?.id ?? null;
        return next;
      })),
      setConversations: guard(setConversations),
      setError: guard(setError),
      setHistoryOpen: guard(setHistoryOpen),
      setNoteProposalsByMessageId: guard(setNoteProposalsByMessageId),
      setOptimisticMessages: guard(setOptimisticMessages),
      setStreamingMessageId: guard(setStreamingMessageId),
      setToolEventsByMessageId: guard(setToolEventsByMessageId),
      submittedComposerSnapshot,
      submittedContextPlan,
      tags,
      toolEventsByMessageId,
      trimmedQuestion: trimmed
    });
  };

  const cancelRun = () => {
    if (runAbortControllerRef.current) stopAssistantBackgroundRun(runAbortControllerRef.current);
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
      return false;
    }
    const generation = ++viewRef.current.generation;
    viewRef.current.conversationId = conversationId;
    runAbortControllerRef.current = null;
    setQueuedDraft(null);
    setConversation(null);
    setBusy(true);
    setError(null);
    setOptimisticMessages([]);
    setStreamingMessageId(null);
    setToolEventsByMessageId({});
    setNoteProposalsByMessageId({});
    try {
      const running = findAssistantBackgroundRun(root, conversationId);
      const loaded = running?.conversation ?? await loadConversation(root, conversationId);
      if (viewRef.current.generation !== generation) return false;
      const latest = findAssistantBackgroundRun(root, conversationId);
      setConversation(latest?.conversation ?? loaded);
      setStreamingMessageId(latest?.streamingMessageId ?? null);
      setToolEventsByMessageId(latest?.toolEventsByMessageId ?? {});
      setNoteProposalsByMessageId(latest?.noteProposalsByMessageId ?? {});
      setError(latest?.error ?? null);
      setQueuedDraft(latest?.queuedDraft ?? null);
      runAbortControllerRef.current = latest?.abortController ?? null;
      setHistoryOpen(false);
      return true;
    } catch (caught) {
      if (viewRef.current.generation === generation) setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      if (viewRef.current.generation === generation) setBusy(Boolean(findAssistantBackgroundRun(root, conversationId)));
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
    if (!root || busy || findAssistantBackgroundRun(root, item.id)) {
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
      setConversationPendingDelete(null);
    }
  };

  const renameConversationHistory = async (item: ConversationMeta, nextTitle: string) => {
    if (!root || busy || findAssistantBackgroundRun(root, item.id)) {
      return;
    }

    const title = nextTitle.trim();
    if (!title || title === item.title) {
      setConversationPendingRename(null);
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
      setConversationPendingRename(null);
    }
  };

  const exportConversationHistory = async (item: ConversationMeta) => {
    if (!root || busy || findAssistantBackgroundRun(root, item.id)) {
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
    setReadingChoice({ root, value: null });
    viewRef.current = { generation: viewRef.current.generation + 1, conversationId: null };
    runAbortControllerRef.current = null;
    setBusy(false);
    setError(null);
    setQueuedDraft(null);
    setComposerResetKey(key => key + 1);
    setConversation(null);
    setOptimisticMessages([]);
    setStreamingMessageId(null);
    setToolEventsByMessageId({});
    setNoteProposalsByMessageId({});
    onClearAssistantContext();
    setHistoryOpen(false);
  };

  const noteReview = useNoteReview();
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
      await persistUpdatedConversationMessage(updatedMessage);
    } catch (caught) {
      const updatedMessage = updateNoteProposalStatus(proposal.id, {
        error: caught instanceof Error ? caught.message : String(caught),
        status: 'error'
      });
      await persistUpdatedConversationMessage(updatedMessage);
    }
  };

  const rejectNoteProposal = async (proposal: AssistantNoteProposal) => {
    const updatedMessage = updateNoteProposalStatus(proposal.id, {
      status: 'rejected'
    });
    await persistUpdatedConversationMessage(updatedMessage);
  };

  const decideMutationProposal = async (proposal: AssistantTagProposal | AssistantEntryMetaProposal, decision: 'apply' | 'reject') => {
    if (!root || !conversation || busy || proposalDecisionLock.current || noteReview?.deciding.length || proposal.status !== 'pending') return;
    const conversationId = conversation.id;
    proposalDecisionLock.current = true;
    setDecidingProposal(proposal.id);
    setError(null);
    try {
      await decideStoredProposal({ root, conversationId, proposal, decision,
        apply: confirmation => 'action' in proposal ? onApplyTagProposal(proposal, confirmation) : onApplyEntryMetaProposal(proposal, confirmation),
        onConversation: saved => setConversation(current => currentRootRef.current === root && current?.id === saved.id ? saved : current)
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (currentRootRef.current === root && viewRef.current.conversationId === conversationId) setError(message);
      notify({ title: '修改未确认完成', description: `${message} 请核对目标数据；系统不会自动重试。`, tone: 'danger' });
    } finally {
      proposalDecisionLock.current = false;
      setDecidingProposal(null);
    }
  };
  const applyTagProposal = (proposal: AssistantTagProposal) => decideMutationProposal(proposal, 'apply');
  const applyEntryMetaProposal = (proposal: AssistantEntryMetaProposal) => decideMutationProposal(proposal, 'apply');
  const rejectTagProposal = (proposal: AssistantTagProposal) => { void decideMutationProposal(proposal, 'reject'); };
  const rejectEntryMetaProposal = (proposal: AssistantEntryMetaProposal) => { void decideMutationProposal(proposal, 'reject'); };

  const updateNoteProposalStatus = (proposalId: string, patch: Partial<AssistantNoteProposal>) => {
    const conversationPatch = conversation
      ? patchConversationNoteProposal(conversation, proposalId, patch)
      : null;

    // Completion belongs to its original conversation even if the user switches
    // chats while a review decision is being written.
    if (viewRef.current.conversationId === conversation?.id) {
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
    }

    if (conversationPatch) {
      const updated = conversationPatch.message.note_proposals?.find(value => value.id === proposalId)
        ?? conversationPatch.message.parts?.flatMap(part => part.type === 'note-proposal' ? [part.proposal] : []).find(value => value.id === proposalId);
      if (updated) noteReview?.publish([{ conversationId: conversationPatch.conversation.id,
        messageId: conversationPatch.message.message_id, proposal: updated }]);
      setConversation(current => current?.id === conversationPatch.conversation.id
        ? patchConversationNoteProposal(current, proposalId, patch)?.conversation ?? current : current);
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
    if (proposalDecisionLock.current || busy) return;
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
  const handleMessageOpenSource = useStableEvent((source: ConversationSourceLink) => {
    if (isSciverseConversationSource(source)) {
      setSciverseDetailSource(source);
      return;
    }
    onOpenSource(source);
  });
  const handleMessageRejectNoteProposal = useStableEvent(rejectNoteProposal);
  const handleMessageRejectEntryMetaProposal = useStableEvent(rejectEntryMetaProposal);
  const handleMessageRejectTagProposal = useStableEvent(rejectTagProposal);
  const handleMessageRegenerateNoteProposal = useStableEvent(regenerateNoteProposal);
  const handleMessageRetryAgentRun = useStableEvent(retryAgentRun);

  useNoteReviewActions({ conversationId: conversation?.id ?? null, disabled: busy || decidingProposal !== null,
    apply: applyNoteProposal, reject: rejectNoteProposal });

  useNoteReviewBridge({ conversation, messages: visibleMessages, proposals: noteProposalsByMessageId,
    backgroundRuns, openConversation, scrollRef: messagesScrollRef, pauseAutoScroll,
    revealAllMessages: () => setMessageRenderLimit(Number.MAX_SAFE_INTEGER),
    closeHistory: () => setHistoryOpen(false),
    onMissing: () => notify({ tone: 'default', title: '未找到对应修改', description: '这条提案可能已移除，请在当前对话中确认。' }) });

  return (
    <aside className="app-sidebar" data-assistant-context-dropzone="true">
      <div className="side-head min-w-0">
        <span className="min-w-0 truncate">助手</span>
        <AssistantRunStatus
          busy={busy}
          error={error}
          queued={Boolean(queuedDraft)}
          streaming={Boolean(streamingMessageId)}
          toolEvents={runStatusToolEvents}
        />
      </div>

      <div className="relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <div className="min-w-0 border-b p-2" data-material="sidebar-toolbar">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{scopeLabel(scope)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon-sm"
                title="聊天历史"
                aria-label="聊天历史"
                type="button"
                variant={historyOpen ? 'secondary' : 'ghost'}
                onClick={() => void toggleConversationHistory()}
              >
                <History />
              </Button>
              <Button
                size="icon-sm"
                title="新建对话"
                aria-label="新建对话"
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
              <SelectTrigger className="w-full" size="sm" aria-label="对话模型">
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
            runningConversationIds={backgroundRuns.flatMap(run => run.conversationId ? [run.conversationId] : [])}
            conversationId={conversation?.id ?? null}
            error={historyError}
            items={visibleConversations}
            loading={historyLoading}
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            onDelete={setConversationPendingDelete}
            onExport={(item) => void exportConversationHistory(item)}
            onOpen={(conversationId) => void openConversation(conversationId)}
            onRename={(item) => {
              setConversationRenameValue(item.title);
              setConversationPendingRename(item);
            }}
          />
          <AssistantBackgroundTasks runs={backgroundRuns} currentConversationId={conversation?.id ?? null}
            onOpen={id => void openConversation(id)} onStop={stopAssistantBackgroundRun} />
        </div>

        <div className="assistant-message-layout relative min-h-0 min-w-0 overflow-hidden">
          <AssistantMessageList
            awaitingApproval={awaitingApproval}
            proposalsDisabled={busy || decidingProposal !== null || Boolean(noteReview?.deciding.length)}
            decidingProposalId={decidingProposal}
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
            onAddSciverseSource={onAddSciverseSource}
            onRegenerateNoteProposal={handleMessageRegenerateNoteProposal}
            onRejectEntryMetaProposal={handleMessageRejectEntryMetaProposal}
            onRejectNoteProposal={handleMessageRejectNoteProposal}
            onRejectTagProposal={handleMessageRejectTagProposal}
            onRetryAgentRun={handleMessageRetryAgentRun}
            onReturnToLatest={forceNextScroll}
            onScroll={handleMessagesScroll}
          />
          {sciverseDetailSource ? (
            <>
              <button
                aria-label="关闭 Sciverse 论文详情"
                className="absolute inset-y-0 right-0 z-10 w-[10%] cursor-default bg-black/45"
                type="button"
                onClick={() => setSciverseDetailSource(null)}
              />
              <SciversePaperDetailDrawer
                source={sciverseDetailSource}
                onClose={() => setSciverseDetailSource(null)}
                onImport={onAddSciverseSource}
              />
            </>
          ) : null}
        </div>

        <div className="min-w-0 border-t p-2" data-material="sidebar-toolbar">
          <ToolApprovalPanel root={root} conversationId={conversation?.id ?? null} onOpen={id => void openConversation(id)} />
          <UserInputPanel root={root} conversationId={conversation?.id ?? null} onOpen={id => void openConversation(id)} onOpenSource={onOpenSource} />
          <div hidden={awaitingUserInput}>
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

          <AssistantReadingContextControl context={readingContext} entries={entries} busy={busy} choice={chosenReadingObject}
            onChange={value => setReadingChoice({ root, value })} />

          <ExecutionRecovery root={root} conversationId={conversation?.id} busy={busy}
            onResume={(id) => { void send(undefined, id); }} />
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
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            {busy ? (
              <>
                <Button size="sm" type="button" variant="outline" onClick={cancelRun}>
                  <Square />
                  停止
                </Button>
                <Button
                  disabled={!selectedProfile || !question.trim() || Boolean(queuedDraft) || readingContext.unavailable}
                  size="sm"
                  type="button"
                  onClick={() => void send()}
                >
                  <Send />
                  {queuedDraft ? '已排队' : '排队发送'}
                </Button>
              </>
            ) : (
              <Button
                disabled={!selectedProfile || !question.trim() || readingContext.unavailable}
                size="sm"
                type="button"
                onClick={() => void send()}
              >
                <Send />
                发送
              </Button>
            )}
          </div>
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(conversationPendingDelete)}
        onOpenChange={(open) => {
          if (!open && !busy) setConversationPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>永久删除对话</DialogTitle>
            <DialogDescription>
              将删除“{conversationPendingDelete?.title}”及其关联的执行记录。对话记录暂不支持回收站恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button disabled={busy} type="button" variant="outline" onClick={() => setConversationPendingDelete(null)}>
              取消
            </Button>
            <Button
              disabled={busy || !conversationPendingDelete}
              type="button"
              variant="destructive"
              onClick={() => conversationPendingDelete && void deleteConversationHistory(conversationPendingDelete)}
            >
              永久删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(conversationPendingRename)}
        onOpenChange={(open) => {
          if (!open && !busy) setConversationPendingRename(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription>新名称会同步显示在聊天历史中。</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            disabled={busy}
            value={conversationRenameValue}
            onChange={(event) => setConversationRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && conversationPendingRename) {
                event.preventDefault();
                void renameConversationHistory(conversationPendingRename, conversationRenameValue);
              }
            }}
          />
          <DialogFooter>
            <Button disabled={busy} type="button" variant="outline" onClick={() => setConversationPendingRename(null)}>
              取消
            </Button>
            <Button
              disabled={busy || !conversationPendingRename || !conversationRenameValue.trim()}
              type="button"
              onClick={() => conversationPendingRename && void renameConversationHistory(conversationPendingRename, conversationRenameValue)}
            >
              保存名称
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
