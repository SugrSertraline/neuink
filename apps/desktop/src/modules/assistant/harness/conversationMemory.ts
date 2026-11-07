import type {
  AssistantConversationMemory,
  ConversationMessage,
  LlmProfile
} from '@/shared/ipc/assistantApi';

import { lastMemoryCheckpointIndex, renderConversationTranscript } from '../runtime/conversationTranscript';
import { renderMessagesForSummary } from '../sdk/summaryTranscript';
import type { RunBudget } from '../agent-core';
import { summarizeConversation } from '../sdk/conversationSummary';
import { modelTranscript } from '../runtime/modelTranscript';

/** The newest checkpoint is sent as the first conversation turn by `answerWithGroundedAgent`. */
export function latestConversationMemory(history: ConversationMessage[]) {
  const message = history[lastMemoryCheckpointIndex(history)];
  const part = message?.parts?.find(part => part.type === 'memory');
  return part?.type === 'memory' ? part.memory : null;
}

export function buildConversationTail(
  history: ConversationMessage[],
  maxChars = 16_000
) {
  const selected: string[] = [];
  let used = 0;
  for (const message of [...history].reverse()) {
    const content = message.content.trim();
    if (!content) continue;
    const role = message.role === 'user' ? 'User' : 'Assistant';
    const remaining = maxChars - used;
    if (remaining <= role.length + 4) break;
    const bounded = content.slice(0, Math.min(content.length, remaining - role.length - 2));
    selected.push(`${role}: ${bounded}`);
    used += role.length + bounded.length + 2;
    if (used >= maxChars) break;
  }
  return selected.reverse().join('\n\n');
}

/**
 * Manual compaction rebuilds from original history when it exists, repairing lossy checkpoints.
 * Imported checkpoints without archived messages still use their retained suffix and summary,
 * returning a `memory` part without a retained suffix. It delegates summarizing to
 * `summarizeConversation` — the same function the loop's usage-triggered projection calls.
 */
export async function updateConversationMemory({
  budget,
  abortSignal,
  history,
  pendingProposalCount,
  settings,
  sourceCount
}: {
  budget?: RunBudget;
  abortSignal?: AbortSignal;
  answer: string;
  history: ConversationMessage[];
  pendingProposalCount: number;
  question: string;
  settings: LlmProfile;
  sourceCount: number;
}): Promise<AssistantConversationMemory> {
  const boundary = lastMemoryCheckpointIndex(history);
  const hasArchivedMessages = history.slice(0, boundary + 1).some(message =>
    message.content.trim() || modelTranscript(message)?.messages.length);
  const summary = await summarizeConversation({
    abortSignal,
    budget,
    dropped: renderMessagesForSummary(renderConversationTranscript(history, undefined,
      { includeSummarized: hasArchivedMessages })),
    chargeTurn: false,
    previous: latestConversationMemory(history),
    settings
  });
  const materialMessageCount = history.filter((message) => !message.message_id.startsWith('client-')).length;
  return {
    ...summary,
    message_count: materialMessageCount,
    pending_proposal_count: pendingProposalCount,
    source_count: sourceCount,
    updated_at: new Date().toISOString()
  };
}
