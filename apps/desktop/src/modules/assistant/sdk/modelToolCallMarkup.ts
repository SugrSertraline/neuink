/** Some providers emit a serialized tool call as text instead of a structured call. */
export function isRawModelToolCall(text: string): boolean {
  return /^\s*<tool_call(?:\s|>)/i.test(text);
}

export function isPotentialRawModelToolCall(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  return !trimmed || '<tool_call'.startsWith(trimmed) || trimmed.startsWith('<tool_call');
}

export function hideRawModelToolCall(text: string): string {
  return isRawModelToolCall(text) ? '' : text;
}
