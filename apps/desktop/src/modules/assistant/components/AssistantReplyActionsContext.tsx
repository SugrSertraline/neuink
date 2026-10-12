import { createContext, useContext } from 'react';
import type { ConversationMessage, ConversationSourceLink, SciverseLibraryImportResult } from '@/shared/ipc/assistantApi';
import type { AssistantContextInput } from '@/shared/types/assistant';

export type AssistantReadingActions = {
  root: string | null;
  openReply: (message: ConversationMessage) => void;
  openSource: (source: ConversationSourceLink, options?: { replyId: string }) => void;
  openContext?: (item: AssistantContextInput) => void;
  addSciverseSource: (source: Extract<ConversationSourceLink, { provider: 'sciverse' }>) => Promise<SciverseLibraryImportResult>;
};
export const AssistantReplyActionsContext = createContext<AssistantReadingActions | null>(null);
export const useAssistantReading = () => useContext(AssistantReplyActionsContext);
