import { loadConversation, type Conversation } from '@/shared/ipc/assistantApi';
import { decideAssistantProposal, type AssistantProposalConfirmation } from '@/shared/ipc/assistantProposalApi';
import type { AssistantEntryMetaProposal, AssistantTagProposal } from '@/shared/types/assistant';

type Proposal = AssistantEntryMetaProposal | AssistantTagProposal;
const locks = new Set<string>();

/** The backend receipt is authoritative; a missing UI acknowledgement must never retry a mutation. */
export async function decideStoredProposal(options: {
  root: string; conversationId: string; proposal: Proposal; decision: 'apply' | 'reject';
  apply: (confirmation: AssistantProposalConfirmation) => Promise<void>;
  onConversation: (conversation: Conversation) => void;
}) {
  const { root, conversationId, proposal, decision } = options;
  const key = JSON.stringify([root, conversationId]);
  if (locks.has(key)) return;
  locks.add(key);
  try {
    const saved = await loadConversation(root, conversationId);
    const message = saved.messages.find(message => message.parts?.some(part =>
      (part.type === 'tag-proposal' || part.type === 'entry-meta-proposal') && part.proposal.id === proposal.id));
    const part = message?.parts?.find(part => (part.type === 'tag-proposal' || part.type === 'entry-meta-proposal') && part.proposal.id === proposal.id);
    if (!message || !part || !('proposal' in part) || part.proposal.status !== 'pending'
      || canonical(part.proposal) !== canonical(proposal)) {
      options.onConversation(saved);
      throw new Error('提案已变化或已处理，请重新查看后确认。未执行新的修改。');
    }
    const confirmation = { conversationId, messageId: message.message_id };
    if (decision === 'apply') await options.apply(confirmation);
    else await decideAssistantProposal(root, proposal, confirmation, 'reject');
    options.onConversation(await loadConversation(root, conversationId));
  } catch (error) {
    // Backend saves "applying" before writing. On transport failure show that state, not a retry button.
    try { options.onConversation(await loadConversation(root, conversationId)); } catch { /* Preserve the primary failure; no mutation retry. */ }
    throw error;
  } finally {
    locks.delete(key);
  }
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}
