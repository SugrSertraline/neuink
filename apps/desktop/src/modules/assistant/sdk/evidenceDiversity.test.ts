import { describe, expect, it } from 'vitest';

import { jaccardSimilarity, lexicalTerms, selectDiverseEvidence } from './evidenceDiversity';

const candidate = (key: string, score: number, text: string) => ({ key, score, text });

describe('evidence diversity (MMR)', () => {
  it('tokenizes CJK as bigrams and Latin as words', () => {
    expect([...lexicalTerms('稀疏注意力 Sparse attention')]).toEqual(
      ['稀疏', '疏注', '注意', '意力', 'sparse', 'attention']
    );
  });

  it('measures overlap with Jaccard similarity', () => {
    expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['c']))).toBe(0);
    expect(jaccardSimilarity(new Set(), new Set(['c']))).toBe(0);
  });

  it('keeps the highest-scoring hit per key', () => {
    const selected = selectDiverseEvidence([
      candidate('e1:s1', 0.2, 'segment note text'),
      candidate('e1:s1', 0.9, 'segment body text'),
      candidate('e2:s2', 0.5, 'other passage')
    ], 5);
    expect(selected.map((item) => item.score)).toEqual([0.9, 0.5]);
  });

  it('promotes a distinct passage over a near-copy of the top hit', () => {
    const selected = selectDiverseEvidence([
      candidate('a', 1.0, 'sparse attention reduces quadratic cost in long context transformers'),
      candidate('b', 0.95, 'sparse attention reduces quadratic cost in long context transformers models'),
      candidate('c', 0.8, 'evaluation on long range arena shows accuracy gains')
    ], 2);
    expect(selected.map((item) => item.key)).toEqual(['a', 'c']);
  });

  it('re-ranks entry-grouped input by global score', () => {
    const selected = selectDiverseEvidence([
      candidate('low', 0.1, 'alpha beta'),
      candidate('high', 0.9, 'gamma delta')
    ], 2);
    expect(selected.map((item) => item.key)).toEqual(['high', 'low']);
  });

  it('respects the limit and empty input', () => {
    expect(selectDiverseEvidence([], 3)).toEqual([]);
    expect(selectDiverseEvidence([candidate('a', 1, 'x y'), candidate('b', 1, 'z w')], 1)).toHaveLength(1);
  });

  it('penalizes a third result from an already crowded section', () => {
    const selected = selectDiverseEvidence([
      { ...candidate('a', 1, 'alpha one'), sectionKey: 'paper-a::Methods' },
      { ...candidate('b', 0.95, 'alpha two'), sectionKey: 'paper-a::Methods' },
      { ...candidate('c', 0.9, 'alpha three'), sectionKey: 'paper-a::Methods' },
      { ...candidate('d', 0.85, 'results finding'), sectionKey: 'paper-a::Results' }
    ], 3);
    expect(selected.map((item) => item.key)).toEqual(['a', 'b', 'd']);
  });

  it('does not penalize an explicit section filter', () => {
    const selected = selectDiverseEvidence([
      { ...candidate('a', 1, 'alpha one'), sectionKey: 'paper-a::Methods' },
      { ...candidate('b', 0.95, 'alpha two'), sectionKey: 'paper-a::Methods' },
      { ...candidate('c', 0.9, 'alpha three'), sectionKey: 'paper-a::Methods' }
    ], 3, undefined, { sectionFilter: 'Methods' });
    expect(selected).toHaveLength(3);
  });

  it('does not crowd out another paper with the same section name', () => {
    const selected = selectDiverseEvidence([
      { ...candidate('a', 1, 'alpha one'), sectionKey: 'paper-a::Introduction' },
      { ...candidate('b', 0.95, 'alpha two'), sectionKey: 'paper-a::Introduction' },
      { ...candidate('c', 0.9, 'alpha three'), sectionKey: 'paper-b::Introduction' },
      { ...candidate('d', 0.85, 'results finding'), sectionKey: 'paper-a::Results' }
    ], 3);
    expect(selected.map((item) => item.key)).toEqual(['a', 'b', 'c']);
  });
});
