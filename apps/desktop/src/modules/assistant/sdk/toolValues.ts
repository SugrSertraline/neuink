import { type ConversationSourceLink, conversationSourceKey } from '@/shared/ipc/assistantApi';

export type JsonObject = Record<string, unknown>;

export function asObject(value: unknown): JsonObject {
  return isPlainObject(value) ? (value as JsonObject) : {};
}

export function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function requiredString(value: unknown, name: string) {
  const text = optionalString(value);
  if (!text) {
    throw new Error(`${name} is required.`);
  }
  return text;
}

export function requiredStringAllowEmpty(value: unknown, name: string) {
  if (typeof value !== 'string') {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function requiredPositiveLine(value: unknown, name: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive 1-based line number.`);
  }
  return value;
}

export function requiredEnum<const T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[]
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

export function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
}

export function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function maxMarker(sourceByMarker: Map<number, ConversationSourceLink>) {
  return Math.max(0, ...sourceByMarker.keys());
}

export function sourceKey(source: ConversationSourceLink) {
  return conversationSourceKey(source);
}

export function noteSnapshotKey(entryId: string, noteId: string) {
  return `${entryId}:${noteId}`;
}

export function rememberReadNote(
  snapshots: Map<string, { markdown: string; title: string }>,
  value: unknown
) {
  const output = asObject(value);
  const entryId = optionalString(output.entry_id);
  const noteId = optionalString(output.note_id);
  if (!entryId || !noteId || typeof output.markdown !== 'string') return;
  snapshots.set(noteSnapshotKey(entryId, noteId), {
    markdown: output.markdown,
    title: optionalString(output.note_title) ?? noteId
  });
}

export function compactQuote(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function trimToBudget(text: string, budget: number) {
  if (text.length <= budget) {
    return text;
  }

  return `${text.slice(0, budget)}\n\n[Context truncated because it exceeds the configured model context length.]`;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
