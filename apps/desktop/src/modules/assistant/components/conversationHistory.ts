import type { ConversationMeta } from '@/shared/ipc/assistantApi';

export function visibleConversationHistory(conversations: ConversationMeta[]) {
  return conversations.filter((conversation) => conversation.message_count > 0);
}
