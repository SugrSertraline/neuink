const DEFAULT_MODEL_CONTEXT_TOKENS = 128_000;
const MIN_MODEL_CONTEXT_TOKENS = 8_000;
const MAX_CONTEXT_CHARS = 2_000_000;
const CHARS_PER_TOKEN = 3.2;

export function modelContextTokens(maxContextLength: number | null | undefined) {
  return Math.max(MIN_MODEL_CONTEXT_TOKENS, maxContextLength ?? DEFAULT_MODEL_CONTEXT_TOKENS);
}

export function assistantContextCharBudget(maxContextLength: number | null | undefined) {
  const modelTokens = modelContextTokens(maxContextLength);
  const reservedTokens = reservedContextTokens(modelTokens);
  const usableInputTokens = Math.max(4_000, modelTokens - reservedTokens);
  return Math.min(MAX_CONTEXT_CHARS, Math.floor(usableInputTokens * CHARS_PER_TOKEN));
}

export function assistantNoteCharBudget(maxContextLength: number | null | undefined) {
  const contextBudget = assistantContextCharBudget(maxContextLength);
  return Math.min(contextBudget, Math.max(32_000, Math.floor(contextBudget * 0.2)));
}

export function estimateTokensFromChars(charCount: number) {
  return Math.max(1, Math.ceil(charCount / CHARS_PER_TOKEN));
}

function reservedContextTokens(modelTokens: number) {
  return Math.max(8_000, Math.min(64_000, Math.floor(modelTokens * 0.12)));
}
