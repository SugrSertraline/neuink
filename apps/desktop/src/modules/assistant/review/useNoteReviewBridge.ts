import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Conversation, ConversationMessage } from '@/shared/ipc/assistantApi';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import type { AssistantBackgroundRunSnapshot } from '../components/assistantBackgroundRuns';
import { noteProposalElementId, useNoteReview, type NoteReviewItem } from './NoteReviewContext';
import { revealReviewTarget } from './reviewNavigation';

export function useNoteReviewBridge({ conversation, messages, proposals, backgroundRuns, openConversation,
  revealAllMessages, closeHistory, scrollRef, onMissing, pauseAutoScroll }: {
  conversation: Conversation | null;
  messages: ConversationMessage[];
  proposals: Record<string, AssistantNoteProposal[]>;
  backgroundRuns: AssistantBackgroundRunSnapshot[];
  openConversation: (id: string) => Promise<boolean>;
  revealAllMessages: () => void;
  closeHistory: () => void;
  scrollRef: RefObject<HTMLDivElement>;
  onMissing: () => void;
  pauseAutoScroll?: () => void;
}) {
  const review = useNoteReview();
  const publish = review?.publish;
  const request = review?.returnRequest;
  const consume = review?.consumeReturn;
  const [ready, setReady] = useState<number | null>(null);
  const latest = useRef({ openConversation, conversation, revealAllMessages, closeHistory, onMissing, pauseAutoScroll });
  latest.current = { openConversation, conversation, revealAllMessages, closeHistory, onMissing, pauseAutoScroll };
  useEffect(() => {
    if (!publish) return;
    const items: NoteReviewItem[] = [];
    const collect = (id: string, values: ConversationMessage[], overrides: Record<string, AssistantNoteProposal[]>) => {
      values.forEach(message => {
        const parts = message.parts?.flatMap(part => part.type === 'note-proposal' ? [part.proposal] : []) ?? [];
        const resolved = overrides[message.message_id] ?? (message.note_proposals?.length ? message.note_proposals : parts);
        resolved.forEach(proposal => items.push({ conversationId: id, messageId: message.message_id, proposal }));
      });
    };
    backgroundRuns.forEach(run => { if (run.conversation) collect(run.conversation.id, run.conversation.messages, run.noteProposalsByMessageId); });
    if (conversation) collect(conversation.id, messages, proposals);
    publish(items);
  }, [publish, conversation, messages, proposals, backgroundRuns]);

  useEffect(() => {
    if (!request) return;
    let cancelled = false;
    setReady(null);
    void (async () => {
      const loaded = latest.current.conversation?.id === request.conversationId ||
        await latest.current.openConversation(request.conversationId);
      if (cancelled) return;
      if (!loaded) { consume?.(request.nonce); return; }
      latest.current.closeHistory();
      setReady(request.nonce);
    })();
    return () => { cancelled = true; };
  }, [request, consume]);

  useEffect(() => {
    if (!request || ready !== request.nonce || conversation?.id !== request.conversationId) return;
    // Run after the conversation-change effect resets the normal history render limit.
    latest.current.pauseAutoScroll?.();
    latest.current.revealAllMessages();
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(noteProposalElementId(request.proposal.id));
      const viewport = scrollRef.current;
      if (target && viewport?.contains(target)) {
        revealReviewTarget(viewport, target, 8);
      } else latest.current.onMissing();
      consume?.(request.nonce);
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, request, conversation?.id, scrollRef, consume]);
}
