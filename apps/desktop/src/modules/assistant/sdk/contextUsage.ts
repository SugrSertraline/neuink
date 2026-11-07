import type { ModelMessage } from 'ai';
import type { AssistantContextUsage } from '@/shared/types/modelTranscript';
import { estimateTokensFromText } from './contextBudget';

/** Count model-visible content, not UI state, provider signatures or JSON message envelopes. */
export function estimateMessageTokens(message: ModelMessage): number {
  if (typeof message.content === 'string') return estimateTokensFromText(message.content) + 4;
  return 4 + message.content.reduce((total, part) => {
    if (part.type === 'text' || part.type === 'reasoning') return total + estimateTokensFromText(part.text);
    if (part.type === 'tool-call') return total + estimateTokensFromText(part.toolName + JSON.stringify(part.input)) + 8;
    if (part.type === 'tool-result') return total + estimateTokensFromText(part.toolName + JSON.stringify(part.output)) + 8;
    return total + estimateTokensFromText(JSON.stringify(part));
  }, 0);
}

export function estimateMessagesTokens(messages: readonly ModelMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function validContextUsage(value: unknown): value is AssistantContextUsage {
  if (!value || typeof value !== 'object') return false;
  const usage = value as AssistantContextUsage;
  return usage.version === 1 && [usage.inputTokens, usage.estimatedInputTokens, usage.messageTokens, usage.overheadTokens]
    .every(value => Number.isSafeInteger(value) && value >= 0)
    && usage.inputTokens > 0 && usage.estimatedInputTokens > 0;
}

export function usageCalibration(usage: AssistantContextUsage | undefined) {
  return validContextUsage(usage) ? usage.inputTokens / usage.estimatedInputTokens : 1;
}

/** Walk backwards over complete assistant/tool batches. Never leave an orphan tool result. */
export function recentContextStart(messages: readonly ModelMessage[], retainedTokens: number, minimumIndex = 0): number {
  let start = messages.length;
  let used = 0;
  while (start > minimumIndex) {
    let batchStart = start - 1;
    if (messages[batchStart].role === 'tool') {
      while (batchStart > minimumIndex && messages[batchStart].role === 'tool') batchStart--;
      if (messages[batchStart].role !== 'assistant') return minimumIndex;
    }
    const tokens = estimateMessagesTokens(messages.slice(batchStart, start));
    // Always retain the newest complete batch, even when it exceeds the nominal tail target.
    if (start < messages.length && used + tokens > retainedTokens) break;
    used += tokens;
    start = batchStart;
  }
  return start;
}
