import { invoke } from '@tauri-apps/api/core';
import type { AssistantEntryMetaProposal, AssistantTagProposal } from '../types/assistant';
import type { EntryMeta, TagMeta } from '../types/domain';

export type AssistantProposalConfirmation = { conversationId: string; messageId: string };
export async function decideAssistantProposal(root: string, proposal: AssistantTagProposal | AssistantEntryMetaProposal,
  confirmation: AssistantProposalConfirmation, decision: 'apply' | 'reject') {
  return invoke<{ status: 'applied' | 'rejected'; entries: EntryMeta[]; tags: TagMeta[] }>('decide_assistant_proposal', {
    request: { root, conversation_id: confirmation.conversationId, message_id: confirmation.messageId,
      proposal_id: proposal.id, expected_proposal: proposal, decision }
  });
}
