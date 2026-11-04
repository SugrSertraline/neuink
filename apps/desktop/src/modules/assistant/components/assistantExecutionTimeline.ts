import type { AssistantMessagePart, AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';

export type AssistantExecutionItem =
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; id: string };

/** Parts retain arrival order; a tool's later receipts update its original row. */
export function executionTimelineFromParts(
  parts: AssistantMessagePart[],
  events: AssistantToolTraceEvent[] = [],
): AssistantExecutionItem[] {
  const items: AssistantExecutionItem[] = [];
  const toolIds = new Set<string>();
  for (const part of parts) {
    if (part.type === 'reasoning') {
      if (part.text.trim()) items.push({ type: 'reasoning', text: part.text });
    } else if (part.type === 'tool-call' || part.type === 'tool-result' || part.type === 'error') {
      const id = part.type === 'error'
        ? part.id ?? `error:${part.toolName ?? 'assistant'}:${part.message}` : part.id;
      if (!toolIds.has(id)) {
        items.push({ type: 'tool', id });
        toolIds.add(id);
      }
    }
  }
  // Older messages and callers can supply traces separately from parts.
  for (const event of events) {
    if (!toolIds.has(event.id)) {
      items.push({ type: 'tool', id: event.id });
      toolIds.add(event.id);
    }
  }
  return items;
}

export function appendExecutionReasoning(items: AssistantExecutionItem[], delta: string): AssistantExecutionItem[] {
  if (!delta) return items;
  const last = items[items.length - 1];
  return last?.type === 'reasoning'
    ? [...items.slice(0, -1), { type: 'reasoning', text: last.text + delta }]
    : [...items, { type: 'reasoning', text: delta }];
}

export function recordExecutionTool(items: AssistantExecutionItem[], id: string): AssistantExecutionItem[] {
  return items.some(item => item.type === 'tool' && item.id === id)
    ? items : [...items, { type: 'tool', id }];
}
