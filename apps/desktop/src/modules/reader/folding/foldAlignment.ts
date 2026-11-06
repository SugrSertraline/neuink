/*
 * Adapted from TextFold textfold/tokens.py and textfold/ladder.py, revision
 * 5fc941dc4560ee2809c0f278da28457292c7f739.
 * Copyright 2026 Xia Chen. Licensed under the Apache License, Version 2.0.
 * Modified for NeuInk: plain text only, bounded memory, and source offsets.
 * See public/licenses/TextFold-LICENSE.txt and TextFold-NOTICE.txt.
 */

export type FoldToken = { text: string; start: number; end: number };
export type FoldTokenAlignment = { generatedIndex: number; sourceIndex: number };

// TextFold treats common function words as non-matches, so they fade rather than
// moving to an unrelated occurrence in a different sentence.
const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'be', 'been', 'and', 'or',
  'that', 'this', 'these', 'those', 'it', 'its', 'for', 'on', 'with', 'as', 'by', 'at', 'from',
  'we', 'our', 'their', 'they', 'which', 'while', 'than', 'then', 'into', 'can', 'not', 'but',
  'such', 'also', 'has', 'have', 'had', 'does', 'do', 'more', 'most', 'less', 'only', 'both',
  '的', '了', '是', '在', '和', '与', '或', '这', '那', '就', '也', '都', '而', '及', '其', '之', '对', '中', '为'
]);

// Han and kana are individual pieces. Offsets are UTF-16 DOM string offsets.
const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|\d+(?:[.,]\d+)+%?|[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*|[^\s]/gu;
const MAX_CELLS = 1_000_000;

export function tokenizeFoldText(text: string): FoldToken[] {
  return Array.from(text.matchAll(TOKEN), match => ({
    text: match[0], start: match.index, end: match.index + match[0].length
  }));
}

export function normalizeFoldToken(value: string): string {
  let word = value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_]/gu, '');
  if (!word || STOP.has(word)) return '';
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) word = word.slice(0, -1);
  return word;
}

/** TextFold's LCS traversal, with a bounded allocation for unusually long input. */
export function longestCommonFoldPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length, m = b.length;
  if (!n || !m || (n + 1) * (m + 1) > MAX_CELLS) return [];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] && a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] && a[i] === b[j]) { pairs.push([i++, j++]); }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Match generated words only against the chosen verbatim evidence sentences. */
export function alignFoldEvidence(
  generated: string,
  sentences: readonly string[],
  evidence: readonly number[]
): { generated: FoldToken[]; source: FoldToken[]; pairs: FoldTokenAlignment[] } {
  const text = evidence.map(index => sentences[index]).filter((value): value is string => value !== undefined).join(' ');
  const source = tokenizeFoldText(text);
  const generatedTokens = tokenizeFoldText(generated);
  const pairs = longestCommonFoldPairs(generatedTokens.map(token => normalizeFoldToken(token.text)), source.map(token => normalizeFoldToken(token.text)))
    .map(([generatedIndex, sourceIndex]) => ({ generatedIndex, sourceIndex }));
  return { generated: generatedTokens, source, pairs };
}

export type FoldTokenView = { text: string; tokens: Array<FoldToken & { key: string }> };

/** Give retained source words the same identity at each level for the motion layer. */
export function buildFoldTokenViews(input: { source: string; sentences: string[] }, result: {
  source: string; evidence: number[]; brief: string[]; key: string; takeaway: string; topic: string;
}): Record<'full' | 'brief' | 'key' | 'takeaway' | 'topic', FoldTokenView> | null {
  if (result.source !== input.source || result.evidence.length !== result.brief.length) return null;
  const fullTokens = tokenizeFoldText(input.source);
  const full = fullTokens.map((token, index) => ({ ...token, key: `source:${index}` }));
  const offsets: number[] = [];
  let cursor = 0;
  for (const sentence of input.sentences) {
    const at = input.source.indexOf(sentence, cursor);
    if (at < 0) return null;
    offsets.push(at);
    cursor = at + sentence.length;
  }
  const fullByRange = new Map(full.map(token => [`${token.start}:${token.end}`, token.key]));
  const briefText = result.brief.join(' ');
  const brief: Array<FoldToken & { key: string }> = [];
  let briefOffset = 0;
  for (let i = 0; i < result.evidence.length; i++) {
    const evidenceIndex = result.evidence[i];
    const sentence = input.sentences[evidenceIndex];
    if (!sentence || sentence !== result.brief[i] || offsets[evidenceIndex] === undefined) return null;
    for (const token of tokenizeFoldText(sentence)) {
      const sourceStart = offsets[evidenceIndex] + token.start, sourceEnd = offsets[evidenceIndex] + token.end;
      const key = fullByRange.get(`${sourceStart}:${sourceEnd}`);
      if (!key) return null;
      brief.push({ ...token, start: briefOffset + token.start, end: briefOffset + token.end, key });
    }
    briefOffset += sentence.length + 1;
  }
  const aligned = alignFoldEvidence(result.key, input.sentences, result.evidence);
  const byGenerated = new Map(aligned.pairs.map(pair => [pair.generatedIndex, brief[pair.sourceIndex]?.key]));
  const generated = aligned.generated.map((token, index) => ({ ...token, key: byGenerated.get(index) ?? `generated:${index}` }));
  const slice = (text: string, name: string): FoldTokenView => {
    const offset = result.key.indexOf(text);
    const mapped = new Map(generated.map(token => [`${token.start}:${token.end}`, token.key]));
    return { text, tokens: tokenizeFoldText(text).map((token, index) => ({ ...token,
      key: offset < 0 ? `${name}:${index}` : mapped.get(`${offset + token.start}:${offset + token.end}`) ?? `${name}:${index}` })) };
  };
  return {
    full: { text: input.source, tokens: full }, brief: { text: briefText, tokens: brief },
    key: { text: result.key, tokens: generated }, takeaway: slice(result.takeaway, 'takeaway'), topic: slice(result.topic, 'topic')
  };
}
