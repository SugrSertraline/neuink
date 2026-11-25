import { describe, expect, it } from 'vitest';
import { alignFoldEvidence, buildFoldTokenViews, longestCommonFoldPairs, tokenizeFoldText } from './foldAlignment';
import { foldViewsForSource } from './foldViews';

describe('TextFold source alignment', () => {
  it('uses ordered longest common subsequences and never matches empty pieces', () => {
    expect(longestCommonFoldPairs(['cat', '', 'dog', 'cat'], ['cat', 'bird', 'dog'])).toEqual([[0, 0], [2, 2]]);
    expect(longestCommonFoldPairs(['', ''], ['', ''])).toEqual([]);
    expect(longestCommonFoldPairs(Array(1_000).fill('x'), Array(1_000).fill('x'))).toEqual([]);
  });

  it('aligns only evidence, normalizes plurals and treats CJK characters separately', () => {
    const aligned = alignFoldEvidence('Cat study 方法', ['Cats study 方法.', 'Unselected words.'], [0]);
    expect(aligned.pairs.map(pair => aligned.source[pair.sourceIndex].text)).toEqual(['Cats', 'study', '方', '法']);
    expect(tokenizeFoldText('中文 cats 2.5%').map(token => token.text)).toEqual(['中', '文', 'cats', '2.5%']);
  });

  it('keeps source token identity across full, brief and generated levels', () => {
    const input = { source: 'Cats sleep. Dogs run.', sentences: ['Cats sleep.', 'Dogs run.'] };
    const result = { source: input.source, evidence: [1], brief: ['Dogs run.'],
      key: 'Dogs run. The study shows this.', takeaway: 'Dogs run.', topic: 'Dogs' };
    const views = buildFoldTokenViews(input, result)!;
    const fullDog = views.full.tokens.find(token => token.text === 'Dogs')!;
    expect(views.brief.tokens.find(token => token.text === 'Dogs')?.key).toBe(fullDog.key);
    expect(views.key.tokens.find(token => token.text === 'Dogs')?.key).toBe(fullDog.key);
    expect(views.takeaway.tokens.find(token => token.text === 'Dogs')?.key).toBe(fullDog.key);
    expect(views.topic.tokens.find(token => token.text === 'Dogs')?.key).toBe(fullDog.key);
    expect(views.brief.text).toBe('Dogs run.');
    expect(buildFoldTokenViews(input, { ...result, brief: ['Fabricated.'] })).toBeNull();
    const stored = { segment_uid: 'x', ...result, model: 'test', generated_at: '2026-01-01' };
    expect(foldViewsForSource(stored, input.source)?.brief.text).toBe('Dogs run.');
    expect(foldViewsForSource(stored, 'Different source.')).toBeNull();
  });
});
