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

export class ModelContextLimitError extends Error {
  constructor() {
    super('本次输入预计超过模型设置的上下文长度，请检查上下文配置或减少输入内容。');
    this.name = 'ModelContextLimitError';
  }
}

/** Approximate preflight, not a provider tokenizer. CJK text needs more room than Latin text. */
export function modelTaskOutputTokens({ maxContextLength, maxOutputTokens, system, prompt }: {
  maxContextLength?: number | null;
  maxOutputTokens?: number;
  system: string;
  prompt: string;
}): number | undefined {
  if (!maxContextLength || !Number.isSafeInteger(maxContextLength) || maxContextLength < 1) return maxOutputTokens;
  const text = system + '\n' + prompt;
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
  const inputTokens = estimateTokensFromChars(text.replace(cjk, '').length) + (text.match(cjk) ?? []).length * 2;
  // Reserve framing/JSON-mode overhead without turning the context window into an output limit.
  const available = maxContextLength - inputTokens - 512;
  if (available < 1) throw new ModelContextLimitError();
  return maxOutputTokens == null ? undefined : Math.min(maxOutputTokens, available);
}

function reservedContextTokens(modelTokens: number) {
  return Math.max(8_000, Math.min(64_000, Math.floor(modelTokens * 0.12)));
}
