import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";

import type { LibraryEntry } from "@/modules/library/components/LibrarySidebar";
import {
  appendConversationMessages,
  createConversation,
  listConversations,
  saveAgentRun,
  updateConversationMessage,
  type AssistantToolTraceEvent,
  type Conversation,
  type ConversationMessage,
  type ConversationMeta,
  type LlmProfile,
  type ScopeSnapshot,
} from "@/shared/ipc/assistantApi";
import type {
  AssistantActiveNote,
  AssistantActiveSegment,
  AssistantActiveSurfaceSnapshot,
  AssistantComposerSnapshot,
  AssistantContext,
  AssistantContextInput,
  AssistantContextItem,
  AssistantContextPlan,
  AssistantNoteProposal,
} from "@/shared/types/assistant";
import type { TagMeta } from "@/shared/types/domain";

import { AssistantHarnessError, runAssistantHarness } from "../harness/engine";
import {
  assistantRunBaseScope,
  buildConversationMentionScope,
  buildTagMentionScopes,
  composerMentionsFromMessages,
  mergeScopeSnapshots,
  mergeScopeWithContextEntries,
} from "./assistantScope";
import {
  buildAssistantMessageParts,
  buildConversationMemory,
  createOptimisticMessage,
  createOptimisticMessageId,
  createSyntheticConversationMessage,
  mergeToolTraceEvent,
  updateConversationMessageLocally,
} from "./assistantPanelState";

const STREAM_RENDER_INTERVAL_MS = 50;

export type QueuedAssistantDraft = {
  activeEntry: { id: string; title: string } | null;
  activeNote: AssistantActiveNote | null;
  activeSegment: AssistantActiveSegment | null;
  activeSurface: AssistantActiveSurfaceSnapshot;
  contextItems: AssistantContextItem[];
  contextPlan: AssistantContextPlan | null;
  question: string;
  snapshot: AssistantComposerSnapshot;
};

export type AssistantBackgroundRunSnapshot = {
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

let assistantBackgroundRun: AssistantBackgroundRunSnapshot | null = null;
const assistantBackgroundRunListeners = new Set<() => void>();

export function getAssistantBackgroundRun() {
  return assistantBackgroundRun;
}

export function setAssistantBackgroundRun(
  patch:
    | AssistantBackgroundRunSnapshot
    | null
    | ((
        current: AssistantBackgroundRunSnapshot | null,
      ) => AssistantBackgroundRunSnapshot | null),
) {
  assistantBackgroundRun =
    typeof patch === "function" ? patch(assistantBackgroundRun) : patch;
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
  toolEventsByMessageId,
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
                conversationId: conversation?.id ?? current.conversationId,
              }
            : null),
          ...(error !== undefined ? { error } : null),
          ...(noteProposalsByMessageId !== undefined
            ? { noteProposalsByMessageId }
            : null),
          ...(streamingMessageId !== undefined ? { streamingMessageId } : null),
          ...(toolEventsByMessageId !== undefined
            ? { toolEventsByMessageId }
            : null),
        }
      : current,
  );
}

type AssistantRunControllerOptions = {
  conversation: Conversation | null;
  entries: LibraryEntry[];
  forceNextScroll: () => void;
  messageContextItems: AssistantContextItem[];
  noteProposalsByMessageId: Record<string, AssistantNoteProposal[]>;
  onAddAssistantContext: (context: AssistantContextInput) => void;
  onCreateAssistantEntry: (title: string) => Promise<LibraryEntry>;
  profiles: LlmProfile[];
  resetComposer: boolean;
  root: string;
  runAbortControllerRef: MutableRefObject<AbortController | null>;
  runEntry: { id: string; title: string } | null;
  runNote: AssistantActiveNote | null;
  runSegment: AssistantActiveSegment | null;
  runSurface: AssistantActiveSurfaceSnapshot;
  scope: ScopeSnapshot;
  selectedProfile: LlmProfile;
  setBusy: (busy: boolean) => void;
  setComposerResetKey: Dispatch<SetStateAction<number>>;
  setConversation: Dispatch<SetStateAction<Conversation | null>>;
  setConversations: Dispatch<SetStateAction<ConversationMeta[]>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  setNoteProposalsByMessageId: Dispatch<
    SetStateAction<Record<string, AssistantNoteProposal[]>>
  >;
  setOptimisticMessages: Dispatch<SetStateAction<ConversationMessage[]>>;
  setStreamingMessageId: Dispatch<SetStateAction<string | null>>;
  setToolEventsByMessageId: Dispatch<
    SetStateAction<Record<string, AssistantToolTraceEvent[]>>
  >;
  submittedComposerSnapshot: AssistantComposerSnapshot;
  submittedContextPlan: AssistantContextPlan | null;
  tags: TagMeta[];
  toolEventsByMessageId: Record<string, AssistantToolTraceEvent[]>;
  trimmedQuestion: string;
};

export async function runAssistantPanelTask({
  conversation,
  entries,
  forceNextScroll,
  messageContextItems,
  noteProposalsByMessageId,
  onAddAssistantContext,
  onCreateAssistantEntry,
  profiles,
  resetComposer,
  root,
  runAbortControllerRef,
  runEntry,
  runNote,
  runSegment,
  runSurface,
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
  trimmedQuestion,
}: AssistantRunControllerOptions) {
  const runContext: AssistantContext = { items: messageContextItems };
  setBusy(true);
  setError(null);
  forceNextScroll();
  if (resetComposer) {
    setComposerResetKey((key) => key + 1);
  }
  runAbortControllerRef.current?.abort();
  const runAbortController = new AbortController();
  runAbortControllerRef.current = runAbortController;
  setAssistantBackgroundRun({
    abortController: runAbortController,
    conversation,
    conversationId: conversation?.id ?? null,
    error: null,
    noteProposalsByMessageId,
    question: trimmedQuestion,
    root,
    streamingMessageId: null,
    toolEventsByMessageId,
  });
  let persistedConversationId: string | null = null;
  let persistedAssistantMessageId: string | null = null;
  let streamedAnswer = "";
  let streamRenderTimer: number | null = null;
  try {
    const conversationMessages = conversation?.messages ?? [];
    const baseScope = assistantRunBaseScope({
      conversationScope: conversation?.scope_snapshot,
      currentScope: scope,
    });
    const runScope = mergeScopeWithContextEntries(
      mergeScopeSnapshots(
        baseScope,
        buildConversationMentionScope({
          entries,
          messages: conversationMessages,
          tags,
        }),
      ),
      runContext,
    );
    const currentConversation =
      conversation ??
      (await createConversation(
        root,
        trimmedQuestion.slice(0, 48),
        runScope,
      ));
    persistedConversationId = currentConversation.id;
    setConversation(currentConversation);
    syncAssistantBackgroundRunState({
      abortController: runAbortController,
      conversation: currentConversation,
    });
    setHistoryOpen(false);

    const assistantMessageId = createOptimisticMessageId("assistant");
    let assistantToolEvents: AssistantToolTraceEvent[] = [];
    let assistantNoteProposals: AssistantNoteProposal[] = [];
    let lastDraftPersistedAt = 0;
    let draftPersistPromise: Promise<void> = Promise.resolve();

    setOptimisticMessages([
      createOptimisticMessage(
        "user",
        trimmedQuestion,
        [],
        undefined,
        messageContextItems,
        submittedComposerSnapshot,
        submittedContextPlan,
      ),
      createOptimisticMessage("assistant", "", [], assistantMessageId),
    ]);
    setStreamingMessageId(assistantMessageId);

    const seededConversation = await appendConversationMessages(
      root,
      currentConversation.id,
      [
        {
          role: "user",
          content: trimmedQuestion,
          parts: buildAssistantMessageParts({
            composerSnapshot: submittedComposerSnapshot,
            content: trimmedQuestion,
            contextItems: messageContextItems,
            contextPlan: submittedContextPlan,
          }),
        },
        {
          role: "assistant",
          content: "",
          parts: buildAssistantMessageParts({ content: "" }),
        },
      ],
    );
    persistedAssistantMessageId =
      [...seededConversation.messages]
        .reverse()
        .find((message) => message.role === "assistant")?.message_id ?? null;
    setConversation(seededConversation);
    setOptimisticMessages([]);
    setStreamingMessageId(persistedAssistantMessageId ?? assistantMessageId);
    syncAssistantBackgroundRunState({
      abortController: runAbortController,
      conversation: seededConversation,
      streamingMessageId: persistedAssistantMessageId ?? assistantMessageId,
    });
    setConversations(await listConversations(root));

    const persistAssistantDraft = (force = false) => {
      if (!persistedAssistantMessageId) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastDraftPersistedAt < 1_000) {
        return;
      }
      lastDraftPersistedAt = now;
      const draftContent = streamedAnswer;
      const draftToolEvents = assistantToolEvents;
      const draftNoteProposals = assistantNoteProposals;
      draftPersistPromise = draftPersistPromise
        .catch(() => undefined)
        .then(async () => {
          if (!persistedAssistantMessageId) {
            return;
          }
          const updated = await updateConversationMessage(
            root,
            currentConversation.id,
            persistedAssistantMessageId,
            {
              content: draftContent,
              note_proposals: draftNoteProposals,
              parts: buildAssistantMessageParts({
                content: draftContent,
                noteProposals: draftNoteProposals,
                toolEvents: draftToolEvents,
              }),
              tool_events: draftToolEvents,
            },
          );
          setConversation((current) =>
            current?.id === updated.id ? updated : current,
          );
          syncAssistantBackgroundRunState({
            abortController: runAbortController,
            conversation: updated,
          });
        });
    };

    const flushStreamingDraft = () => {
      if (streamRenderTimer !== null) {
        window.clearTimeout(streamRenderTimer);
        streamRenderTimer = null;
      }
      const draftParts = buildAssistantMessageParts({
        content: streamedAnswer,
        noteProposals: assistantNoteProposals,
        toolEvents: assistantToolEvents,
      });
      const messageId = persistedAssistantMessageId ?? assistantMessageId;
      const applyDraft = (current: Conversation | null) =>
        updateConversationMessageLocally(
          current,
          messageId,
          {
            content: streamedAnswer,
            note_proposals: assistantNoteProposals,
            parts: draftParts,
            tool_events: assistantToolEvents,
          },
          currentConversation.id,
        );
      setConversation(applyDraft);
      syncAssistantBackgroundRunState({
        abortController: runAbortController,
        conversation: applyDraft(getAssistantBackgroundRun()?.conversation ?? null),
        noteProposalsByMessageId: {
          ...(getAssistantBackgroundRun()?.noteProposalsByMessageId ?? {}),
          [messageId]: assistantNoteProposals,
        },
        toolEventsByMessageId: {
          ...(getAssistantBackgroundRun()?.toolEventsByMessageId ?? {}),
          [messageId]: assistantToolEvents,
        },
      });
      persistAssistantDraft();
    };

    const scheduleStreamingDraft = () => {
      if (streamRenderTimer !== null) {
        return;
      }
      streamRenderTimer = window.setTimeout(
        flushStreamingDraft,
        STREAM_RENDER_INTERVAL_MS,
      );
    };

    const runEntries = entries;
    const grounded = await runAssistantHarness({
      abortSignal: runAbortController.signal,
      availableEntries: runEntries.map((entry) => ({
        description: entry.fields.description ?? "",
        id: entry.id,
        title: entry.title,
        updatedAt: entry.updatedAt,
      })),
      availableNotes: runEntries.flatMap((entry) =>
        entry.contents.map((note) => ({
          entryId: entry.id,
          entryTitle: entry.title,
          noteId: note.note_id,
          title: note.title,
        })),
      ),
      availableTags: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        parentId: tag.parent_id,
      })),
      assistantContext: runContext,
      contextPlan: submittedContextPlan,
      composerSnapshot: submittedComposerSnapshot,
      conversationId: currentConversation.id,
      conversationHistory: currentConversation.messages,
      currentEntry: runEntry,
      currentNote: runNote,
      currentSegment: runSegment,
      currentSurface: runSurface,
      destinationEntryId: null,
      mentionScope: runScope,
      tagMentionScopes: buildTagMentionScopes({
        entries,
        tagIds: [
          ...composerMentionsFromMessages(conversationMessages),
          ...submittedComposerSnapshot.mentions,
        ].flatMap((mention) =>
          mention.kind === "tag" && mention.tagId ? [mention.tagId] : [],
        ),
        tags,
      }),
      onCreateEntry: async (title) => {
        const entry = await onCreateAssistantEntry(title);
        onAddAssistantContext({
          entryId: entry.id,
          entryTitle: entry.title,
          id: `entry:${entry.id}`,
          kind: "entry",
        });
        return {
          description: entry.fields.description ?? "",
          id: entry.id,
          title: entry.title,
          updatedAt: entry.updatedAt,
        };
      },
      onDelta: (delta) => {
        streamedAnswer += delta;
        scheduleStreamingDraft();
      },
      onNoteProposal: undefined,
      onToolEvent: (event) => {
        assistantToolEvents = mergeToolTraceEvent(assistantToolEvents, event);
        const messageId = persistedAssistantMessageId ?? assistantMessageId;
        const draftParts = buildAssistantMessageParts({
          content: streamedAnswer,
          noteProposals: assistantNoteProposals,
          toolEvents: assistantToolEvents,
        });
        const applyDraft = (current: Conversation | null) =>
          updateConversationMessageLocally(
            current,
            messageId,
            {
              content: streamedAnswer,
              note_proposals: assistantNoteProposals,
              parts: draftParts,
              tool_events: assistantToolEvents,
            },
            currentConversation.id,
          );
        setToolEventsByMessageId((current) => ({
          ...current,
          [messageId]: assistantToolEvents,
        }));
        setConversation(applyDraft);
        syncAssistantBackgroundRunState({
          abortController: runAbortController,
          conversation: applyDraft(
            getAssistantBackgroundRun()?.conversation ?? null,
          ),
          noteProposalsByMessageId:
            getAssistantBackgroundRun()?.noteProposalsByMessageId ?? {},
          toolEventsByMessageId: {
            ...(getAssistantBackgroundRun()?.toolEventsByMessageId ?? {}),
            [messageId]: assistantToolEvents,
          },
        });
        persistAssistantDraft();
      },
      question: trimmedQuestion,
      profiles,
      root,
      scope: runScope,
      settings: selectedProfile,
    });

    if (streamRenderTimer !== null) {
      window.clearTimeout(streamRenderTimer);
      streamRenderTimer = null;
    }

    const finalToolEvents = grounded.toolEvents ?? assistantToolEvents;
    const finalNoteProposals = grounded.noteProposals ?? assistantNoteProposals;
    const finalEntryMetaProposals = grounded.entryMetaProposals ?? [];
    const finalTagProposals = grounded.tagProposals ?? [];
    const assistantParts = buildAssistantMessageParts({
      agentRun: grounded.agentRun,
      content: grounded.answer,
      entryMetaProposals: finalEntryMetaProposals,
      memory: buildConversationMemory([
        ...currentConversation.messages,
        createSyntheticConversationMessage("user", trimmedQuestion),
        createSyntheticConversationMessage(
          "assistant",
          grounded.answer,
          grounded.sources,
          finalNoteProposals,
        ),
      ]),
      noteProposals: finalNoteProposals,
      tagProposals: finalTagProposals,
      plan: grounded.plan,
      sourceLinks: grounded.sources,
      taskState: grounded.taskState,
      toolEvents: finalToolEvents,
    });

    await draftPersistPromise.catch(() => undefined);

    const updated = persistedAssistantMessageId
      ? await updateConversationMessage(
          root,
          currentConversation.id,
          persistedAssistantMessageId,
          {
            content: grounded.answer,
            note_proposals: finalNoteProposals,
            parts: assistantParts,
            source_links: grounded.sources,
            tool_events: finalToolEvents,
          },
        )
      : await appendConversationMessages(root, currentConversation.id, [
          {
            role: "assistant",
            content: grounded.answer,
            note_proposals: finalNoteProposals,
            parts: assistantParts,
            source_links: grounded.sources,
            tool_events: finalToolEvents,
          },
        ]);
    const persistedAssistant = [...updated.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (grounded.agentRun) {
      void saveAgentRun(root, {
        answerPreview: grounded.answer,
        conversationId: currentConversation.id,
        entryId: scope.entry_ids[0] ?? null,
        messageId:
          persistedAssistant?.message_id ?? persistedAssistantMessageId ?? null,
        question: trimmedQuestion,
        run: grounded.agentRun,
      }).catch((error) => {
        console.error("Failed to save agent run", error);
      });
    }
    if (persistedAssistant && finalToolEvents.length > 0) {
      setToolEventsByMessageId((current) => ({
        ...current,
        [persistedAssistant.message_id]: finalToolEvents,
      }));
    }
    if (persistedAssistant && finalNoteProposals.length > 0) {
      setNoteProposalsByMessageId((current) => ({
        ...current,
        [persistedAssistant.message_id]: finalNoteProposals,
      }));
    }
    setConversation(updated);
    syncAssistantBackgroundRunState({
      abortController: runAbortController,
      conversation: updated,
      noteProposalsByMessageId:
        persistedAssistant && finalNoteProposals.length > 0
          ? {
              ...(getAssistantBackgroundRun()?.noteProposalsByMessageId ?? {}),
              [persistedAssistant.message_id]: finalNoteProposals,
            }
          : (getAssistantBackgroundRun()?.noteProposalsByMessageId ?? {}),
      streamingMessageId: null,
      toolEventsByMessageId:
        persistedAssistant && finalToolEvents.length > 0
          ? {
              ...(getAssistantBackgroundRun()?.toolEventsByMessageId ?? {}),
              [persistedAssistant.message_id]: finalToolEvents,
            }
          : (getAssistantBackgroundRun()?.toolEventsByMessageId ?? {}),
    });
    setOptimisticMessages([]);
    setStreamingMessageId(null);
    setConversations(await listConversations(root));
  } catch (caught) {
    const failedAgentRun =
      caught instanceof AssistantHarnessError ? caught.agentRun : undefined;
    if (root && persistedConversationId && persistedAssistantMessageId) {
      const conversationId = persistedConversationId;
      const assistantMessageId = persistedAssistantMessageId;
      const errorMessage = caught instanceof Error ? caught.message : String(caught);
      const fallbackContent = "";
      const fallbackParts = buildAssistantMessageParts({
        agentRun: failedAgentRun,
        content: fallbackContent,
        taskState:
          caught instanceof AssistantHarnessError ? caught.taskState : undefined,
      });
      fallbackParts.push({
        message: errorMessage,
        type: "error",
      });
      setConversation((current) =>
        updateConversationMessageLocally(
          current,
          assistantMessageId,
          { content: fallbackContent, parts: fallbackParts },
          conversationId,
        ),
      );
      syncAssistantBackgroundRunState({
        abortController: runAbortController,
        conversation: updateConversationMessageLocally(
          getAssistantBackgroundRun()?.conversation ?? null,
          assistantMessageId,
          { content: fallbackContent, parts: fallbackParts },
          conversationId,
        ),
        error: errorMessage,
        streamingMessageId: null,
      });
      void updateConversationMessage(root, conversationId, assistantMessageId, {
        content: fallbackContent,
        parts: fallbackParts,
      }).catch(() => undefined);
      if (failedAgentRun) {
        void saveAgentRun(root, {
          answerPreview: errorMessage,
          conversationId,
          entryId: scope.entry_ids[0] ?? null,
          messageId: assistantMessageId,
          question: trimmedQuestion,
          run: failedAgentRun,
        }).catch((error) => {
          console.error("Failed to save failed agent run", error);
        });
      }
    }
    setOptimisticMessages([]);
    setStreamingMessageId(null);
    setError(caught instanceof Error ? caught.message : String(caught));
  } finally {
    if (streamRenderTimer !== null) {
      window.clearTimeout(streamRenderTimer);
    }
    if (runAbortControllerRef.current === runAbortController) {
      runAbortControllerRef.current = null;
    }
    setAssistantBackgroundRun((current) =>
      current?.abortController === runAbortController ? null : current,
    );
    setBusy(false);
  }
}
