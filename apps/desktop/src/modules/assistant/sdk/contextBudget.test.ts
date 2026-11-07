import { describe, expect, it } from 'vitest';
import { assistantContextCharBudget, assistantUsableInputTokens, estimateTokensFromChars, estimateTokensFromText, modelContextTokens, reservedContextTokens } from './contextBudget';
describe('context budget', () => {
  it('keeps the reserved headroom that the character budget was built on', () => {
    expect(modelContextTokens(64_000)).toBe(64_000);
    expect(reservedContextTokens(64_000)).toBe(8_000);
    expect(assistantUsableInputTokens(64_000)).toBe(56_000);
    expect(assistantContextCharBudget(64_000)).toBe(179_200);
    // An unusable window still leaves a floor, so the callers never divide by nothing.
    expect(assistantUsableInputTokens(0)).toBe(4_000);
  });
  it('estimates Latin text at four characters per token', () => {
    expect(estimateTokensFromText('a'.repeat(1_000))).toBe(250);
    expect(estimateTokensFromText('')).toBe(1);
  });
  it('stops under-counting Chinese by nearly five times', () => {
    const chinese = '中'.repeat(400);
    expect(estimateTokensFromText(chinese)).toBe(600);
    // The sizing estimate used for tool output hydration is the reason this exists: on the same
    // text it reports 125 tokens, about a fifth of what the provider actually bills.
    expect(estimateTokensFromChars(chinese.length)).toBe(125);
  });
  it('counts mixed scripts character by character', () => {
    // 4 CJK (6 tokens) + 8 Latin (2 tokens).
    expect(estimateTokensFromText('中文测试abcdefgh')).toBe(8);
  });
});
