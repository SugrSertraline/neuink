/**
 * Maximal Marginal Relevance (Carbonell & Goldstein, SIGIR 1998) over search
 * evidence. The backend ranks by relevance only, so a single long section often
 * fills every slot with near-identical snippets; MMR trades a little relevance
 * for coverage of distinct passages before results reach the model.
 */

const DEFAULT_LAMBDA = 0.7;
/** Snippets this similar are treated as the same passage, not as diversity. */
const DUPLICATE_SIMILARITY = 0.9;

export type DiversityCandidate = {
  key: string;
  score: number;
  text: string;
  /**
   * Entry-qualified section identity (for example `entryId::sectionId`). Bare
   * section paths collide across papers, so callers must qualify them. Empty or
   * null means the hit has no section and receives no chapter penalty.
   */
  sectionKey?: string | null;
};

export type DiversityOptions = {
  /** An explicit section filter makes same-section evidence intentional. */
  sectionFilter?: string | null;
};

/** Non-finite backend scores count as 0 so they cannot poison min/max normalization. */
function finiteScore(score: number) {
  return Number.isFinite(score) ? score : 0;
}

export function lexicalTerms(text: string) {
  const terms = new Set<string>();
  const normalized = text.toLowerCase();
  for (const word of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)) {
      // CJK has no word boundaries; character bigrams match the backend tokenizer.
      const chars = [...word];
      if (chars.length === 1) terms.add(chars[0]);
      for (let index = 0; index < chars.length - 1; index += 1) {
        terms.add(chars[index] + chars[index + 1]);
      }
    } else if (word.length >= 2) {
      terms.add(word);
    }
  }
  return terms;
}

export function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const term of small) if (large.has(term)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Returns candidates in MMR order, dropping duplicate keys and near-duplicate text. */
export function selectDiverseEvidence<T extends DiversityCandidate>(
  candidates: T[],
  limit: number,
  lambda = DEFAULT_LAMBDA,
  options: DiversityOptions = {}
): T[] {
  const unique = new Map<string, T>();
  for (const candidate of candidates) {
    const existing = unique.get(candidate.key);
    if (!existing || finiteScore(candidate.score) > finiteScore(existing.score)) unique.set(candidate.key, candidate);
  }
  const pool = [...unique.values()].map((candidate) => ({ candidate, terms: lexicalTerms(candidate.text) }));
  if (pool.length === 0 || limit <= 0) return [];

  const scores = pool.map(({ candidate }) => finiteScore(candidate.score));
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const relevance = scores.map((score) => (max > min ? (score - min) / (max - min) : 1));

  const selected: typeof pool = [];
  const remaining = pool.map((item, index) => ({ ...item, relevance: relevance[index], index }));
  while (selected.length < limit && remaining.length > 0) {
    let bestPosition = -1;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let position = 0; position < remaining.length; position += 1) {
      const item = remaining[position];
      const redundancy = selected.reduce(
        (highest, chosen) => Math.max(highest, jaccardSimilarity(item.terms, chosen.terms)),
        0
      );
      if (redundancy >= DUPLICATE_SIMILARITY) continue;
      const sameSectionCount = item.candidate.sectionKey
        ? selected.filter((chosen) => chosen.candidate.sectionKey === item.candidate.sectionKey).length
        : 0;
      const sectionPenalty = options.sectionFilter || sameSectionCount < 2 ? 0 : Math.min(0.3, 0.15 * sameSectionCount);
      const value = lambda * item.relevance - (1 - lambda) * redundancy - sectionPenalty;
      // Ties keep the backend order so equal-score results stay deterministic.
      if (value > bestValue || (value === bestValue && item.index < remaining[bestPosition].index)) {
        bestValue = value;
        bestPosition = position;
      }
    }
    if (bestPosition < 0) break;
    selected.push(remaining[bestPosition]);
    remaining.splice(bestPosition, 1);
  }
  return selected.map(({ candidate }) => candidate);
}
