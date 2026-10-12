import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import { ASSISTANT_READ_FAILURES, safeAssistantReadFailure } from '@/shared/lib/assistantReadFailure';

/** Keep rejected prose out of the persisted answer; completed actions are independent. */
export function rejectedAnswerContent(error: unknown, events: readonly AssistantToolTraceEvent[]): string | undefined {
  const failure = safeAssistantReadFailure(error);
  if (failure !== ASSISTANT_READ_FAILURES.citation && failure !== ASSISTANT_READ_FAILURES.contract) return;
  const receipts = events.filter(event => event.status === 'done' && event.toolName === 'import_papers' && event.summary)
    .map(event => event.summary!);
  return receipts.length ? `回答未通过核验。已完成的操作仍保留：\n\n${receipts.map(summary => `- ${summary}`).join('\n')}` : '';
}
