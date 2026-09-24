/** @vitest-environment jsdom */
import { useEffect, useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Conversation, ConversationMessage } from '@/shared/ipc/assistantApi';
import type { AssistantNoteProposal } from '@/shared/types/assistant';
import { NoteReviewProvider, noteProposalElementId, useNoteReview } from './NoteReviewContext';
import { useNoteReviewBridge } from './useNoteReviewBridge';

afterEach(cleanup);
const proposal: AssistantNoteProposal = { id: 'proposal', action: 'replace', entryId: 'entry', entryTitle: 'Paper', noteId: 'note',
  title: 'Note', markdown: 'New', beforeMarkdown: 'Old', sources: [], status: 'pending', createdAt: '' };
const message = { message_id: 'first-message', role: 'assistant', content: 'Response', source_links: [], created_at: '',
  parts: [{ type: 'note-proposal', proposal }] } as ConversationMessage;
const oldConversation = { id: 'old', messages: [message] } as Conversation;
function Fixture({ load, missing }: { load: (id: string) => Promise<boolean>; missing: () => void }) {
  const review = useNoteReview()!;
  const [conversation, setConversation] = useState<Conversation>({ id: 'new', messages: [] } as unknown as Conversation);
  const [renderAll, setRenderAll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => review.publish([{ conversationId: 'old', messageId: message.message_id, proposal }]), [review.publish]);
  // Same lifecycle as AssistantPanel: a different conversation resets its rendered history.
  useEffect(() => setRenderAll(false), [conversation.id]);
  useNoteReviewBridge({ conversation, messages: conversation.messages, proposals: {}, backgroundRuns: [],
    scrollRef, closeHistory: () => {}, revealAllMessages: () => setRenderAll(true), onMissing: missing,
    openConversation: async id => { const ok = await load(id); if (ok) setConversation(oldConversation); return ok; } });
  return <><button onClick={() => review.returnToConversation(proposal.id)}>返回旧提案</button>
    <output>{review.returnRequest ? '定位中' : '空闲'}</output>
    <div ref={scrollRef}>{renderAll && conversation.id === 'old' ? <section id={noteProposalElementId(proposal.id)} tabIndex={-1}>旧提案</section> : null}</div>
  </>;
}
it('loads the original conversation and reveals/focuses a proposal beyond the history window', async () => {
  const load = vi.fn(async () => true); const missing = vi.fn();
  render(<NoteReviewProvider onOpen={vi.fn()} onShowAssistant={vi.fn()}><Fixture load={load} missing={missing} /></NoteReviewProvider>);
  fireEvent.click(screen.getByText('返回旧提案'));
  await waitFor(() => expect(document.activeElement?.id).toBe(noteProposalElementId(proposal.id)));
  expect(load).toHaveBeenCalledWith('old');
  expect(missing).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toBe('空闲');
  fireEvent.click(screen.getByText('返回旧提案'));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('空闲'));
  expect(load).toHaveBeenCalledTimes(1);
});
it('consumes failed history navigation without jumping into a different conversation', async () => {
  const load = vi.fn(async () => false);
  render(<NoteReviewProvider onOpen={vi.fn()} onShowAssistant={vi.fn()}><Fixture load={load} missing={vi.fn()} /></NoteReviewProvider>);
  fireEvent.click(screen.getByText('返回旧提案'));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('空闲'));
  expect(screen.queryByText('旧提案')).toBeNull();
});
