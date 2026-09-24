import type { ApplicationActions } from '../runtime/applicationActions';
import { requestToolApproval } from '../runtime/toolApproval';
import { requestUserInput } from '../runtime/userInput';
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
import { acknowledgeExecution } from '../harness/durableHarness';
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
  createOptimisticMessage,
  createOptimisticMessageId,
  mergeToolTraceEvent,
  updateConversationMessageLocally,
} from "./assistantPanelState";

import {
  findAssistantBackgroundRun, finishAssistantBackgroundRun, getAssistantBackgroundRun,
  setAssistantBackgroundRun, syncAssistantBackgroundRunState,
} from './assistantBackgroundRuns';
export { getAssistantBackgroundRun, setAssistantBackgroundRun, subscribeAssistantBackgroundRun } from './assistantBackgroundRuns';

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

type AssistantRunControllerOptions = {
  resumeExecutionId?: string;
  applicationActions?: ApplicationActions;
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
  resumeExecutionId,
  applicationActions,
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
  // A different conversation may run concurrently, but one conversation has one writer.
  if (conversation && findAssistantBackgroundRun(root, conversation.id)) {
    setError('这个对话仍在运行，请等待完成或先停止。');
    return;
  }
  const runContext: AssistantContext = { items: messageContextItems };
  setBusy(true);
  setError(null);
  forceNextScroll();
  if (resetComposer) {
    setComposerResetKey((key) => key + 1);
  }
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
  let streamedReasoning = "";
  let assistantToolEvents: AssistantToolTraceEvent[] = [];
  let assistantNoteProposals: AssistantNoteProposal[] = [];
  let streamRenderTimer: number | null = null;
  let draftPersistPromise: Promise<void> = Promise.resolve();
  let acceptingEvents = true;
  let resultDelivered = false;
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
    let lastDraftPersistedAt = 0;

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
      const draftReasoning = streamedReasoning;
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
                reasoning: draftReasoning,
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
      // The next draft/final save still observes this rejection, but a paused stream
      // must not leave a rejected promise unhandled while waiting for the model.
      void draftPersistPromise.catch(() => undefined);
    };

    const flushStreamingDraft = () => {
      if (!acceptingEvents || runAbortController.signal.aborted) return;
      if (streamRenderTimer !== null) {
        window.clearTimeout(streamRenderTimer);
        streamRenderTimer = null;
      }
      const draftParts = buildAssistantMessageParts({
        content: streamedAnswer,
        noteProposals: assistantNoteProposals,
        reasoning: streamedReasoning,
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
        conversation: applyDraft(getAssistantBackgroundRun(runAbortController)?.conversation ?? null),
        noteProposalsByMessageId: {
          ...(getAssistantBackgroundRun(runAbortController)?.noteProposalsByMessageId ?? {}),
          [messageId]: assistantNoteProposals,
        },
        toolEventsByMessageId: {
          ...(getAssistantBackgroundRun(runAbortController)?.toolEventsByMessageId ?? {}),
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
      resumeExecutionId,
      applicationActions,
      requestUserInput: async (request, signal) => {
        try { return await requestUserInput(root, currentConversation.id)(request, signal); }
        catch (error) { runAbortController.abort(error); throw error; }
      },
      requestToolApproval: async (request, signal) => {
        const approved = await requestToolApproval(root, currentConversation.id)(request, signal);
        if (!approved) runAbortController.abort(new Error('用户已拒绝本次操作，任务已停止。'));
        return approved;
      },
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
        if (!acceptingEvents || runAbortController.signal.aborted) return;
        streamedAnswer += delta;
        scheduleStreamingDraft();
      },
      onAnswerReset: () => {
        if (!acceptingEvents || runAbortController.signal.aborted) return;
        streamedAnswer = "";
        scheduleStreamingDraft();
      },
      onReasoningDelta: (delta) => {
        if (!acceptingEvents || runAbortController.signal.aborted) return;
        streamedReasoning += delta;
        scheduleStreamingDraft();
      },
      onNoteProposal: undefined,
      onToolEvent: (event) => {
        if (!acceptingEvents || runAbortController.signal.aborted) return;
        assistantToolEvents = mergeToolTraceEvent(assistantToolEvents, event);
        const messageId = persistedAssistantMessageId ?? assistantMessageId;
        const draftParts = buildAssistantMessageParts({
          content: streamedAnswer,
          noteProposals: assistantNoteProposals,
          reasoning: streamedReasoning,
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
            getAssistantBackgroundRun(runAbortController)?.conversation ?? null,
          ),
          noteProposalsByMessageId:
            getAssistantBackgroundRun(runAbortController)?.noteProposalsByMessageId ?? {},
          toolEventsByMessageId: {
            ...(getAssistantBackgroundRun(runAbortController)?.toolEventsByMessageId ?? {}),
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

    acceptingEvents = false;
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
      memory: grounded.conversationMemory ?? null,
      noteProposals: finalNoteProposals,
      reasoning: streamedReasoning,
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
    resultDelivered = true;
    const persistedAssistant = [...updated.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (grounded.executionId) {
      try {
        await acknowledgeExecution(root, grounded.executionId,
          Boolean(finalNoteProposals.length || finalEntryMetaProposals.length || finalTagProposals.length));
      } catch {
        // The answer/proposals are already saved. Do not replace them with an error-only draft.
        setError('结果已经保存，但任务完成状态未能确认。继续任务只会取回已有结果，不会重做已完成的操作。');
      }
    }
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
              ...(getAssistantBackgroundRun(runAbortController)?.noteProposalsByMessageId ?? {}),
              [persistedAssistant.message_id]: finalNoteProposals,
            }
          : (getAssistantBackgroundRun(runAbortController)?.noteProposalsByMessageId ?? {}),
      streamingMessageId: null,
      toolEventsByMessageId:
        persistedAssistant && finalToolEvents.length > 0
          ? {
              ...(getAssistantBackgroundRun(runAbortController)?.toolEventsByMessageId ?? {}),
              [persistedAssistant.message_id]: finalToolEvents,
            }
          : (getAssistantBackgroundRun(runAbortController)?.toolEventsByMessageId ?? {}),
    });
    setOptimisticMessages([]);
    setStreamingMessageId(null);
    setConversations(await listConversations(root));
  } catch (caught) {
    acceptingEvents = false;
    if (streamRenderTimer !== null) {
      window.clearTimeout(streamRenderTimer);
      streamRenderTimer = null;
    }
    // Drain already queued writes before saving the terminal state; otherwise a late
    // streaming draft can overwrite the error/result after this task has ended.
    await draftPersistPromise.catch(() => undefined);
    if (resultDelivered) {
      setError('结果已保存，但后续状态刷新失败。请重新打开对话查看，已保存的结果不会被覆盖。');
      return;
    }
    const failedAgentRun =
      caught instanceof AssistantHarnessError ? caught.agentRun : undefined;
    if (root && persistedConversationId && persistedAssistantMessageId) {
      const conversationId = persistedConversationId;
      const assistantMessageId = persistedAssistantMessageId;
      const errorMessage = caught instanceof Error ? caught.message : String(caught);
      const fallbackContent = streamedAnswer;
      const fallbackParts = buildAssistantMessageParts({
        agentRun: failedAgentRun,
        content: fallbackContent,
        reasoning: streamedReasoning,
        taskState:
          caught instanceof AssistantHarnessError ? caught.taskState : undefined,
        toolEvents: assistantToolEvents,
      });
      fallbackParts.push({
        message: errorMessage,
        type: "error",
      });
      setConversation((current) =>
        updateConversationMessageLocally(
          current,
          assistantMessageId,
          { content: fallbackContent, parts: fallbackParts, tool_events: assistantToolEvents },
          conversationId,
        ),
      );
      syncAssistantBackgroundRunState({
        abortController: runAbortController,
        conversation: updateConversationMessageLocally(
          getAssistantBackgroundRun(runAbortController)?.conversation ?? null,
          assistantMessageId,
          { content: fallbackContent, parts: fallbackParts, tool_events: assistantToolEvents },
          conversationId,
        ),
        error: errorMessage,
        streamingMessageId: null,
      });
      await updateConversationMessage(root, conversationId, assistantMessageId, {
        content: fallbackContent,
        parts: fallbackParts,
        tool_events: assistantToolEvents,
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
    syncAssistantBackgroundRunState({ abortController: runAbortController,
      error: caught instanceof Error ? caught.message : String(caught), streamingMessageId: null });
  } finally {
    acceptingEvents = false;
    if (streamRenderTimer !== null) {
      window.clearTimeout(streamRenderTimer);
    }
    finishAssistantBackgroundRun(runAbortController);
    if (runAbortControllerRef.current === runAbortController) {
      runAbortControllerRef.current = null;
    }
    setBusy(false);
  }
}
