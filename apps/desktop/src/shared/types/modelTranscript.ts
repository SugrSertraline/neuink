import type { ModelMessage } from 'ai';
import type { ConversationSourceLink } from '../ipc/assistantApi';

export type AssistantContextUsage = {
  version: 1;
  inputTokens: number;
  estimatedInputTokens: number;
  messageTokens: number;
  overheadTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/** Model-visible messages produced by one run, independent of the UI's tool trace. */
export type AssistantModelTranscript = {
  version: 1 | 2;
  runId: string;
  capturedAt: string;
  profileId: string;
  model: string;
  protocol: string;
  outcome?: 'running' | 'completed' | 'failed' | 'cancelled';
  messages: ModelMessage[];
  /** Version 2 stores exactly the new input suffix, including the original user message. */
  inputMessages?: ModelMessage[];
  /** Only sources first allocated in this run; previous mappings remain in earlier records. */
  sources: Array<[number, ConversationSourceLink]>;
  /** The UI numbers sources per answer; model history uses stable conversation markers. */
  displaySourceMarkers?: number[];
  contextUsage?: AssistantContextUsage;
};
