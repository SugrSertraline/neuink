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
import { ASSISTANT_ACTION_INCOMPLETE, ASSISTANT_TOOL_PENDING, formatAssistantError, readAssistantDebug, useAssistantDebug } from '@/shared/lib/assistantDebug';
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
import type { PdfParseAction } from '@/modules/library/components/PdfParseButton';
import { resolveAssistantReadingContext, type AssistantReadingChoice } from './assistantReadingContext';
import { SciversePaperDetailDrawer } from '@/modules/sciverse/components/SciversePaperDetailDrawer';
import {
  getAssistantBackgroundRun,
  runAssistantPanelTask,
  subscribeAssistantBackgroundRun,
  type QueuedAssistantDraft
} from './assistantRunController';
import { findAssistantBackgroundRun, getAssistantBackgroundRuns, getAssistantMessageQueues, guardAssistantView, queueAssistantBackgroundRun, stopAssistantBackgroundRun, syncAssistantMessageQueueConversation, type AssistantBackgroundRunSnapshot, type AssistantMessageQueueSnapshot } from './assistantBackgroundRuns';
import { subscribeAssistantConversationNavigation } from './assistantConversationNavigation';
import { AssistantMessageQueue } from './AssistantMessageQueue';
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
import { LOCAL_AGENTS, localAgentName, readLastAssistantEngine, saveLastAssistantEngine, useLocalAgentEnabled, type AssistantEngine } from '@/shared/lib/localAgentSettings';
import { localAgentProfile, localAgentSelection, selectionLocalProvider, conversationLocalSession } from '../local-agent/session';
import { useLocalAgentDetections } from '@/shared/lib/useLocalAgentDetections';
import { latestConversationMemory } from '../harness/conversationMemory';
import { ResearchPanel, ResearchSetup } from '../research/ResearchPanel';
import { useResearchTasks, type ResearchModel } from '../research/useResearchTasks';
import { useResearchChat } from '../research/useResearchChat';
import { researchSelections } from '../research/researchChat';
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
  pdfParseAction?: PdfParseAction;
  researchModel?: ResearchModel;
  researchOpenRequest?: number;
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
  onOpenResearchSettings?: () => void;
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
  pdfParseAction,
  researchModel,
  researchOpenRequest,
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
  onOpenResearchSettings,
  onOpenSource,
  onAddSciverseSource,
  onReplaceAssistantContext,
  onRemoveAssistantContextItem
}: AssistantPanelProps) {
  const { notify, dismiss } = useToast();
  const { appearance, setAppearance } = useAppearance();
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [researchMode, setResearchMode] = useState(false);
  const fallbackResearch = useResearchTasks(researchModel ? null : root);
  const research = researchModel ?? fallbackResearch;
  const researchChat = useResearchChat(root, research);
  useEffect(() => { if (researchOpenRequest) { setResearchMode(true); if (research.status?.active?.id && !research.status.active.installation) research.select(research.status.active.id); } }, [researchOpenRequest]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const localAgentEnabled = useLocalAgentEnabled();
  const [selectedEngine, setSelectedEngine] = useState<AssistantEngine>(readLastAssistantEngine);
  const engineSelectionRevision = useRef(0);
  const {results:localDetections} = useLocalAgentDetections(localAgentEnabled,true);
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
  const [messageQueues, setMessageQueues] = useState<AssistantMessageQueueSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [decidingProposal, setDecidingProposal] = useState<string | null>(null);
  const proposalDecisionLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const debug = useAssistantDebug();
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
  const messageQueue = messageQueues.find(queue => queue.root === root && queue.conversationId !== null && queue.conversationId === conversation?.id) ?? null;
  const previousRootRef = useRef(root);
  const currentRootRef = useRef(root);
  currentRootRef.current = root;
  const [readingChoice, setReadingChoice] = useState<{ root: string | null; value: AssistantReadingChoice }>({ root, value: null });
  const chosenReadingObject = readingChoice.root === root ? readingChoice.value : null;
  const readingContext = resolveAssistantReadingContext({ choice: chosenReadingObject, entries, tags, items: assistantContext.items,
    activeEntry, activeNote, activeSegment, activeSurface });

  const selectedTagIds = useMemo(
    () =>
      [...(readingContext.tag ? [readingContext.tag.id] : []), ...composerSnapshot.mentions
        .filter((mention) => mention.kind === 'tag' && mention.tagId)
        .map((mention) => mention.tagId as string)],
    [composerSnapshot.mentions, readingContext.tag]
  );
  const scope = useMemo(
    () => buildAssistantScope({ activeEntry: readingContext.entry, activeTag: readingContext.bound || readingContext.entry || readingContext.surface.kind !== 'library' ? null : activeTag, entries, selectedTagIds, tags }),
    [readingContext.entry, readingContext.bound, readingContext.surface.kind, activeTag, entries, selectedTagIds, tags]
  );
  const localConversation = conversationLocalSession(conversation)?.provider ?? null;
  const localProvider = conversation?.messages.length ? localConversation : selectedEngine === 'model' ? null : selectedEngine;
  const usingLocalAgent = Boolean(localProvider);
  const localDetection = localProvider ? localDetections[localProvider] : null;
  const selectedProfile = localProvider ? (localAgentEnabled && localDetection?.status === 'detected' ? localAgentProfile(localProvider) : null)
    : profiles.find(profile => profile.id === selectedProfileId) ?? null;
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
    contentVersion: researchMode ? `${research.selected}:${research.task?.report.length}:${research.task?.stage}` : scrollContentVersion,
    conversationId: researchMode ? `research-${research.selected ?? 'new'}` : conversation?.id
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
  const researchSubmissionView = useRef({ root, researchMode, composerSnapshot });
  researchSubmissionView.current = { root, researchMode, composerSnapshot };
  const selectableContextEntries = useMemo(
    () => [...entries].sort((left, right) => left.title.localeCompare(right.title)),
    [entries]
  );
  const externalContextItems = useMemo(() => {
    return externalAssistantContextItems(assistantContext.items, composerSnapshot);
  }, [assistantContext.items, composerSnapshot.mentions]);
  const composerDisabled = !root || !selectedProfile;

  useEffect(() => {
    if (root && selectedProfile && !usingLocalAgent) void warmAssistantRouter();
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
      engineSelectionRevision.current += 1;
      previousRootRef.current = root;
      setConversation(null);
      setSelectedEngine(readLastAssistantEngine());
      setBusy(false);
      setError(null);
      setMessageQueues([]);
      setOptimisticMessages([]);
      setStreamingMessageId(null);
      setToolEventsByMessageId({});
      setNoteProposalsByMessageId({});
    }
    const syncBackgroundRun = (finished?: AssistantBackgroundRunSnapshot) => {
      if (finished && finished.root === root) {
        if (finished.conversationId !== viewRef.current.conversationId &&
            (!getAssistantMessageQueues(root).some(queue => queue.conversationId === finished.conversationId && !queue.paused) || finished.error || finished.abortController.signal.aborted)) {
          notify({ title: finished.abortController.signal.aborted ? '后台对话已停止' : finished.error ? '后台对话运行失败' : '后台对话已完成',
            description: finished.conversation?.title ?? finished.question,
            tone: finished.error && !finished.abortController.signal.aborted ? 'danger' : 'success' });
        }
        void listConversations(root).then(items => { if (mounted) setConversations(items); })
          .catch(() => { if (mounted) setHistoryError('聊天历史刷新失败，请重新打开历史记录。'); });
      }
      setBackgroundRuns(root ? getAssistantBackgroundRuns(root) : []);
      setMessageQueues(root ? getAssistantMessageQueues(root) : []);
      const run = root && viewRef.current.conversationId
        ? findAssistantBackgroundRun(root, viewRef.current.conversationId)
        : runAbortControllerRef.current ? getAssistantBackgroundRun(runAbortControllerRef.current) : null;
      if (!run) {
        if (runAbortControllerRef.current) {
          setBusy(false);
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
    if (researchMode && !queued && !resumeExecutionId) {
      if (!selectedProfile || usingLocalAgent || selectedProfile.api_protocol !== 'openai_compatible') return;
      try {
        const submitted = composerSnapshot;
        const selections = researchSelections(orderedAssistantContextItems(assistantContext.items, composerSnapshot), composerSnapshot, entries);
        if (await researchChat.send(question, selectedProfile.id, selections)) {
          if (researchSubmissionView.current.root === root && researchSubmissionView.current.researchMode && researchSubmissionView.current.composerSnapshot === submitted) {
            setComposerSnapshot({ mentions: [], text: '' }); setComposerResetKey(key => key + 1); forceNextScroll();
          }
        }
      } catch (caught) { researchChat.setError(String(caught)); }
      return;
    }
    const trimmed = resumeExecutionId ? '继续未完成任务' : (queued?.question ?? question).trim();
    if (!root || !selectedProfile || !trimmed) {
      return;
    }
    if (!queued && !resumeExecutionId && readingContext.unavailable) return;
    const currentRun = conversation ? findAssistantBackgroundRun(root, conversation.id)
      : runAbortControllerRef.current ? getAssistantBackgroundRun(runAbortControllerRef.current) : null;
    if (!queued && !currentRun && (busy || messageQueue?.items.length)) return;
    if (currentRun && !queued) {
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
        scope: structuredClone(scope),
        snapshot
      };
      const controller = currentRun.abortController;
      const queuedGeneration = viewRef.current.generation;
      if (!queueAssistantBackgroundRun(controller, draft, (latest, frozenDraft) =>
        send(frozenDraft, undefined, latest, queuedGeneration))) return;
      setComposerSnapshot({ mentions: [], text: '' });
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
      scope: queued?.scope ?? scope,
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
    const selectionRevision = ++engineSelectionRevision.current;
    const nextProvider = selectionLocalProvider(profileId);
    const nextEngine = nextProvider ?? 'model';
    if (conversation?.messages.length && nextProvider !== localConversation) {
      // Switching execution engines starts a separate history, preserving the reading target.
      startNewConversation(true);
    }
    setSelectedEngine(nextEngine);
    const remember = () => {
      if (!saveLastAssistantEngine(nextEngine)) setError('本次选择已生效，但未能保存；下次打开时可能无法恢复。');
    };
    if (nextProvider) { remember(); return; }
    setSelectedProfileId(profileId);
    try {
      const settingsState = await setTaskLlmProfile('assistant', profileId);
      if (selectionRevision !== engineSelectionRevision.current) return;
      setProfiles(settingsState.profiles);
      setSelectedProfileId(settingsState.assistant_profile_id ?? profileId);
      remember();
    } catch (caught) {
      if (selectionRevision === engineSelectionRevision.current) setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const openConversation = async (conversationId: string) => {
    if (!root) {
      return false;
    }
    const generation = ++viewRef.current.generation;
    viewRef.current.conversationId = conversationId;
    runAbortControllerRef.current = null;
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
      if (!latest) syncAssistantMessageQueueConversation(root, loaded);
      setConversation(latest?.conversation ?? loaded);
      setSelectedEngine(conversationLocalSession(loaded)?.provider ?? 'model');
      setStreamingMessageId(latest?.streamingMessageId ?? null);
      setToolEventsByMessageId(latest?.toolEventsByMessageId ?? {});
      setNoteProposalsByMessageId(latest?.noteProposalsByMessageId ?? {});
      setError(latest?.error ?? null);
      setMessageQueues(getAssistantMessageQueues(root));
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

  const navigateConversation = useStableEvent((id: string) => { void openConversation(id); });
  useEffect(() => root ? subscribeAssistantConversationNavigation(root, request => navigateConversation(request.conversationId)) : undefined,
    [root, navigateConversation]);

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
    if (!root || busy || findAssistantBackgroundRun(root, item.id) || getAssistantMessageQueues(root).some(queue => queue.conversationId === item.id)) {
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
        description: formatAssistantError(message, { debug: readAssistantDebug(), fallback: ASSISTANT_ACTION_INCOMPLETE }),
        title: '删除失败',
        tone: 'danger'
      });
    } finally {
      setBusy(false);
      setConversationPendingDelete(null);
    }
  };

  const renameConversationHistory = async (item: ConversationMeta, nextTitle: string) => {
    if (!root || busy || findAssistantBackgroundRun(root, item.id) || getAssistantMessageQueues(root).some(queue => queue.conversationId === item.id)) {
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
        description: formatAssistantError(message, { debug: readAssistantDebug(), fallback: ASSISTANT_ACTION_INCOMPLETE }),
        title: '重命名失败',
        tone: 'danger'
      });
    } finally {
      setBusy(false);
      setConversationPendingRename(null);
    }
  };

  const exportConversationHistory = async (item: ConversationMeta) => {
    if (!root || busy || findAssistantBackgroundRun(root, item.id) || getAssistantMessageQueues(root).some(queue => queue.conversationId === item.id)) {
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
        description: formatAssistantError(message, { debug: readAssistantDebug(), fallback: ASSISTANT_ACTION_INCOMPLETE }),
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
        description: formatAssistantError(message, { debug: readAssistantDebug(), fallback: ASSISTANT_ACTION_INCOMPLETE }),
        title: '导出失败',
        tone: 'danger'
      });
    } finally {
      setBusy(false);
    }
  };

  const startNewConversation = (preserveContext = false) => {
    setSelectedEngine(readLastAssistantEngine());
    if (!preserveContext) setReadingChoice({ root, value: null });
    viewRef.current = { generation: viewRef.current.generation + 1, conversationId: null };
    runAbortControllerRef.current = null;
    setBusy(false);
    setError(null);
    if (!preserveContext) setComposerResetKey(key => key + 1);
    setConversation(null);
    setOptimisticMessages([]);
    setStreamingMessageId(null);
    setToolEventsByMessageId({});
    setNoteProposalsByMessageId({});
    if (!preserveContext) onClearAssistantContext();
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
        onConversation: saved => {
          syncAssistantMessageQueueConversation(root, saved);
          setConversation(current => currentRootRef.current === root && current?.id === saved.id ? saved : current);
        }
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (currentRootRef.current === root && viewRef.current.conversationId === conversationId) setError(message);
      notify({ title: '修改未确认完成', description: formatAssistantError(message, { debug: readAssistantDebug(), fallback: '请核对目标数据；系统不会自动重试。' }), tone: 'danger' });
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
      syncAssistantMessageQueueConversation(root, conversationState);
      setConversation((current) =>
        current?.id === conversationState.id ? conversationState : current
      );
      setConversations(await listConversations(root));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      notify({
        description: formatAssistantError(message, { debug: readAssistantDebug(), fallback: ASSISTANT_ACTION_INCOMPLETE }),
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
        <Button className="ml-auto" size="xs" variant={researchMode ? 'secondary' : 'ghost'} role="switch" aria-label="深度研究" aria-checked={researchMode} onClick={() => { setResearchMode(value => !value); setHistoryOpen(false); }}>深度研究{researchMode ? ' · 开' : ' · 关'}</Button>
        <AssistantRunStatus
          busy={researchMode ? Boolean(research.status?.active) || researchChat.sending : busy}
          error={researchMode ? research.error : error}
          queued={!researchMode && Boolean(messageQueue?.items.length)}
          streaming={researchMode ? research.task?.status === 'running' && Boolean(research.task.report) : Boolean(streamingMessageId)}
          toolEvents={researchMode ? [] : runStatusToolEvents}
        />
      </div>

      <div className="grid relative min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <div className="min-w-0 border-b p-2" data-material="sidebar-toolbar">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{researchMode ? '深度研究 · 自动检索' : scopeLabel(scope)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="icon-sm"
                title="聊天历史"
                aria-label="聊天历史"
                type="button"
                variant={historyOpen ? 'secondary' : 'ghost'}
                onClick={() => researchMode ? setHistoryOpen(value => !value) : void toggleConversationHistory()}
              >
                <History />
              </Button>
              <Button
                size="icon-sm"
                title="新建对话"
                aria-label="新建对话"
                type="button"
                variant="ghost"
                onClick={() => { if (researchMode) { research.select(null); setHistoryOpen(false); } else startNewConversation(); }}
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
              disabled={(!localAgentEnabled && profiles.length === 0 && !usingLocalAgent) || busy}
              value={localProvider ? localAgentSelection(localProvider) : selectedProfile?.id ?? ''}
              onValueChange={(value) => void selectProfile(value)}
            >
              <SelectTrigger className="w-full" size="sm" aria-label="对话模型">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {(localAgentEnabled || usingLocalAgent) && LOCAL_AGENTS.map(agent => <SelectItem key={agent.id} value={localAgentSelection(agent.id)} disabled={!localAgentEnabled || localDetections[agent.id]?.status !== 'detected'}>{agent.name} · 本地 Agent</SelectItem>)}
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
              {usingLocalAgent ? !localAgentEnabled ? '本地 Agent 已关闭，请在设置 → 检索与工具中启用。'
                : localDetection?.message ?? `正在检测 ${localProvider ? localAgentName(localProvider) : '本地 Agent'}…` : '请先在设置中配置模型或启用本地 Agent。'}
            </div>
          ) : null}

          {!researchMode && error ? (
            <div className="mt-2 rounded-md border border-destructive/25 bg-destructive/5 p-2 text-xs leading-5 text-destructive">
              {formatAssistantError(error, { debug, fallback: busy ? ASSISTANT_TOOL_PENDING : '助手未完成本次操作，请核对结果后再继续。' })}
            </div>
          ) : null}

          {!researchMode && conversationMemory && visibleMessages.length > 0 ? (
            <div className="mt-2 rounded-md border bg-muted/20 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
              <div className="flex min-w-0 items-center gap-1.5">
                <Info className="shrink-0" size={12} aria-hidden="true" />
                <span className="min-w-0 truncate">Memory: {conversationMemory.summary}</span>
              </div>
            </div>
          ) : null}

          <AssistantBackgroundTasks runs={backgroundRuns} currentConversationId={conversation?.id ?? null}
            onOpen={id => void openConversation(id)} onStop={stopAssistantBackgroundRun} />
        </div>

        {/* Keep the overlay anchored to the full panel: glass hover makes the toolbar positioned. */}
        <AssistantConversationHistory
          busy={busy}
          runningConversationIds={[...backgroundRuns.flatMap(run => run.conversationId ? [run.conversationId] : []),
            ...messageQueues.flatMap(queue => queue.conversationId ? [queue.conversationId] : [])]}
          conversationId={conversation?.id ?? null}
          error={historyError}
          items={visibleConversations}
          loading={historyLoading}
          open={historyOpen && !researchMode}
          onClose={() => setHistoryOpen(false)}
          onDelete={setConversationPendingDelete}
          onExport={(item) => void exportConversationHistory(item)}
          onOpen={(conversationId) => void openConversation(conversationId)}
          onRename={(item) => {
            setConversationRenameValue(item.title);
            setConversationPendingRename(item);
          }}
        />

        <div className="assistant-message-layout relative min-h-0 min-w-0 overflow-hidden">
          {researchMode ? <ResearchPanel root={root} model={research} entries={entries} onApply={onApplyNoteProposal} onOpenSource={onOpenSource}
            scrollRef={messagesScrollRef} contentRef={messagesContentRef} endRef={messagesEndRef} onScroll={handleMessagesScroll}
            historyOpen={historyOpen} onCloseHistory={() => setHistoryOpen(false)} /> : <AssistantMessageList
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
          />}
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
          <AssistantMessageQueue queue={messageQueue} running={busy} />
          <ToolApprovalPanel root={root} conversationId={conversation?.id ?? null} onOpen={id => void openConversation(id)} />
          <UserInputPanel root={root} conversationId={conversation?.id ?? null} onOpen={id => void openConversation(id)} onOpenSource={onOpenSource} />
          <div hidden={!researchMode && awaitingUserInput}>
          {!researchMode && longConversation.isLong ? (
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
                      onClick={() => startNewConversation()}
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
            onRemove={id => {
              const item = externalContextItems.find(item => item.id === id);
              onRemoveAssistantContextItem(id);
              if (!item) return;
              const toastId = notify({ title: '已移除引用', action: <Button size="xs" variant="ghost" onClick={() => {
                if (currentRootRef.current === root) onAddAssistantContext(contextItemToInput(item));
                dismiss(toastId);
              }}>撤销</Button> });
            }}
          />

          {!researchMode ? <AssistantReadingContextControl context={readingContext} entries={entries} tags={tags} busy={busy} choice={chosenReadingObject}
            pdfParseAction={pdfParseAction}
            onChange={value => setReadingChoice({ root, value })} /> : <>
            <ResearchSetup model={research} onOpenSettings={onOpenResearchSettings ?? onOpenSettings} />
            {researchChat.error ? <p role="alert" className="mb-2 text-xs text-destructive">{researchChat.error}</p> : null}
            {usingLocalAgent || selectedProfile && selectedProfile.api_protocol !== 'openai_compatible' ? <p className="mb-2 text-xs text-muted-foreground">请选择已有的 OpenAI 兼容模型以开始深度研究。</p> : null}
            <p className="mb-2 text-[11px] text-muted-foreground">自动深入调研；仅发送附加资料，按所选模型服务计费。</p>
          </>}

          {!researchMode ? <ExecutionRecovery root={root} conversationId={conversation?.id} busy={busy}
            onResume={(id) => { void send(undefined, id); }} /> : null}
          <AssistantComposerEditor
            actions={researchMode ? (research.status?.active && !research.status.active.installation ? <Button size="sm" variant="outline" disabled={research.busy || !research.status.active.id} onClick={() => void research.command({ kind: 'cancel' })}><Square />停止研究</Button>
              : <Button size="sm" disabled={!root || !selectedProfile || usingLocalAgent || selectedProfile.api_protocol !== 'openai_compatible' || !question.trim() || researchChat.sending || research.busy || !research.status?.ready || Boolean(research.status?.active) || research.status?.pending_save} onClick={() => void send()}><Send />{researchChat.sending ? '正在准备…' : '发送'}</Button>) : busy ? <>
              <Button size="sm" type="button" variant="outline" onClick={cancelRun}>
                <Square />
                停止
              </Button>
              <Button
                disabled={!selectedProfile || !question.trim() || readingContext.unavailable || !conversation || Boolean(runAbortControllerRef.current?.signal.aborted)}
                size="sm"
                type="button"
                onClick={() => void send()}
              >
                <Send />
                排队发送
              </Button>
            </> : <Button
              data-guide="assistant-send"
              disabled={!selectedProfile || !question.trim() || readingContext.unavailable || Boolean(messageQueue?.items.length)}
              size="sm"
              type="button"
              onClick={() => void send()}
            >
              <Send />
              发送
            </Button>}
            composerDraft={composerDraft}
            workspaceRoot={root}
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
              const nextInlineIds = new Set(contextItems.map(item => item.id));
              const preservedExternalItems = assistantContext.items
                .filter((item) => !previousInlineIds.has(item.id) && !nextInlineIds.has(item.id))
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
