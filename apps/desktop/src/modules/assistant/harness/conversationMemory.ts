import type { ConversationMessage } from '@/shared/ipc/assistantApi';

export function appendConversationMemory(
  harnessBrief: string,
  history: ConversationMessage[]
) {
  const memory = formatConversationMemory(history);
  return memory ? `${harnessBrief}\n\nConversation Memory:\n${memory}` : harnessBrief;
}

export function latestConversationMemory(history: ConversationMessage[]) {
  for (const message of [...history].reverse()) {
    const part = (message.parts ?? []).slice().reverse()
      .find((candidate) => candidate.type === 'memory');
    if (part?.type === 'memory') return part.memory;
  }
  return null;
}

function formatConversationMemory(history: ConversationMessage[]) {
  const stored = latestConversationMemory(history);
  if (stored) {
    return [
      `Summary: ${stored.summary}`,
      stored.last_user_goal ? `Last user goal: ${stored.last_user_goal}` : null,
      stored.open_items.length > 0 ? `Open items: ${stored.open_items.join('; ')}` : null,
      `Cited sources so far: ${stored.source_count}`,
      `Pending proposals: ${stored.pending_proposal_count}`
    ].filter((line): line is string => Boolean(line)).join('\n');
  }
  return history.filter((message) => message.content.trim().length > 0).slice(-8)
    .map((message) => {
      const role = message.role === 'user' ? 'User' : 'Assistant';
      return `${role}: ${trimMemoryText(message.content, 2_400)}`;
    }).join('\n\n');
}

function trimMemoryText(text: string, maxLength: number) {
  const compact = text.trim();
  return compact.length <= maxLength
    ? compact
    : `${compact.slice(0, maxLength)}\n[Earlier message truncated.]`;
}
