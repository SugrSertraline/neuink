const DEFAULT_MODEL_CONTEXT_TOKENS = 128_000;
const MIN_MODEL_CONTEXT_TOKENS = 8_000;
const MAX_CONTEXT_CHARS = 2_000_000;
const CHARS_PER_TOKEN = 3.2;
/** Compaction fires once the estimate reaches this share of the model window. The UI ring reads
 *  the same estimate against the same window, and its 0.7 warning band only advises. */
export const COMPACTION_TRIGGER_RATIO = 0.9;
/** Advisory band: the ring and the usage notice warn from here, but compaction does not fire. */
export const CONTEXT_WARNING_RATIO = 0.7;
/** English runs about four characters per token, which is close enough in practice. */
const LATIN_CHARS_PER_TOKEN = 4;
/** One ideograph costs a provider between one and two tokens; the midpoint over-estimates
 *  on purpose, because guessing high compacts early while guessing low overflows the window. */
const CJK_TOKENS_PER_CHAR = 1.5;
/** CJK punctuation, kana, ideograph extensions, compatibility ideographs and fullwidth forms. */
const CJK_PATTERN = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/g;

export function modelContextTokens(maxContextLength: number | null | undefined) {
  return Math.max(MIN_MODEL_CONTEXT_TOKENS, maxContextLength ?? DEFAULT_MODEL_CONTEXT_TOKENS);
}

export function assistantUsableInputTokens(maxContextLength: number | null | undefined) {
  const modelTokens = modelContextTokens(maxContextLength);
  return Math.max(4_000, modelTokens - reservedContextTokens(modelTokens));
}

export function assistantContextCharBudget(maxContextLength: number | null | undefined) {
  return Math.min(MAX_CONTEXT_CHARS, Math.floor(assistantUsableInputTokens(maxContextLength) * CHARS_PER_TOKEN));
}

export function assistantNoteCharBudget(maxContextLength: number | null | undefined) {
  const contextBudget = assistantContextCharBudget(maxContextLength);
  return Math.min(contextBudget, Math.max(32_000, Math.floor(contextBudget * 0.2)));
}

/** Size estimate for hydrated tool output, where 3.2 characters per token is the agreed nominal. */
export function estimateTokensFromChars(charCount: number) {
  return Math.max(1, Math.ceil(charCount / CHARS_PER_TOKEN));
}

/** Compaction safety estimate: CJK counted per character, Latin at four characters per token.
 *  Deliberately separate from `estimateTokensFromChars`, which sizes hydrated tool output and
 *  under-counts Chinese by roughly 3.2x — feeding compaction through it is what lets a mostly
 *  Chinese conversation reach the window while still reading as "nowhere near the limit". */
export function estimateTokensFromText(text: string) {
  const cjkChars = (text.match(CJK_PATTERN) ?? []).length;
  const latinChars = text.length - cjkChars;
  return Math.max(1, Math.ceil(cjkChars * CJK_TOKENS_PER_CHAR + latinChars / LATIN_CHARS_PER_TOKEN));
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

export function reservedContextTokens(modelTokens: number) {
  return Math.max(8_000, Math.min(64_000, Math.floor(modelTokens * 0.12)));
}
