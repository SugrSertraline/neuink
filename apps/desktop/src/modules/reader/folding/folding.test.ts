import { describe, expect, it } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';

import { buildFoldInputs, foldLengthUnits, foldSectionForSegment } from './foldInput';
import { foldResultMatchesSource, validateFoldBatch } from './foldResult';

function segment(uid: string, text: string, overrides: Partial<SourceSegment> = {}): SourceSegment {
  return { uid, text, segment_type: 'paragraph', markdown: null, page_idx: 0, bbox: null, ...overrides };
}

describe('folding source preparation', () => {
  it('restricts section generation to the selected heading range', () => {
    const items = [segment('h1', 'First', { segment_type: 'heading' }), segment('a', 'A.'),
      segment('b', 'B.'), segment('h2', 'Second', { segment_type: 'heading' }), segment('c', 'C.')];
    expect(foldSectionForSegment(items, 'b').map(item => item.uid)).toEqual(['a', 'b']);
    expect(foldSectionForSegment(items, 'c').map(item => item.uid)).toEqual(['c']);
    expect(foldSectionForSegment(items, null)).toEqual([]);
  });
  it('only includes safe body paragraphs and keeps section boundaries', () => {
    const first = `First finding. ${Array(38).fill('Context').join(' ')}.`;
    const second = `${Array(40).fill('evidence').join(' ')}.`;
    const input = buildFoldInputs([
      segment('first', first),
      segment('heading', 'Methods', { segment_type: 'heading' }),
      segment('second', second),
      segment('math', 'x is $x^2$.', { markdown: 'x is $x^2$.' }),
      segment('formatted', 'Important finding.', { markdown: '**Important** finding.' }),
      segment('link', 'Evidence', { markdown: '[Evidence](https://example.com)' }),
      segment('continued', 'Cross page', { continuation_group_id: 'g' }),
      segment('figure', 'Figure 1', { segment_type: 'figure' }),
      segment('long', 'x'.repeat(7_501))
    ]);
    expect(input.batches.map(batch => batch.map(item => item.segmentUid))).toEqual([['first'], ['second']]);
    expect(input.batches[0][0].sentences).toEqual(['First finding.', `${Array(38).fill('Context').join(' ')}.`]);
    expect(input.skipped).toEqual([
      { segmentUid: 'heading', reason: 'unsupported' },
      { segmentUid: 'math', reason: 'inline_math' },
      { segmentUid: 'formatted', reason: 'rich_content' },
      { segmentUid: 'link', reason: 'rich_content' },
      { segmentUid: 'continued', reason: 'continuation' },
      { segmentUid: 'figure', reason: 'unsupported' },
      { segmentUid: 'long', reason: 'too_long' }
    ]);
  });

  it('applies the minimum consistently to English, CJK, mixed text and punctuation', () => {
    expect(foldLengthUnits(`${Array(20).fill('word').join(' ')} !!!`)).toBe(40);
    expect(foldLengthUnits('中'.repeat(40) + '，。')).toBe(40);
    expect(foldLengthUnits(`${Array(10).fill('word').join(' ')} ${'中'.repeat(20)}`)).toBe(40);
    const inputs = buildFoldInputs([
      segment('english-short', Array(19).fill('word').join(' ')),
      segment('english-boundary', Array(20).fill('word').join(' ')),
      segment('chinese-short', '中'.repeat(39)),
      segment('chinese-boundary', '中'.repeat(40)),
      segment('mixed', `${Array(10).fill('word').join(' ')} ${'中'.repeat(20)}`),
      segment('punctuation', '!'.repeat(400))
    ]);
    expect(inputs.batches.flat().map(item => item.segmentUid)).toEqual(['english-boundary', 'chinese-boundary', 'mixed']);
    expect(inputs.skipped).toEqual([
      { segmentUid: 'english-short', reason: 'too_short' },
      { segmentUid: 'chinese-short', reason: 'too_short' },
      { segmentUid: 'punctuation', reason: 'too_short' }
    ]);
  });

  it('never generates results for ambiguous duplicate identifiers', () => {
    const input = buildFoldInputs([segment('same', 'One.'), segment('same', 'Two.')]);
    expect(input.batches).toEqual([]);
    expect(input.skipped).toEqual([
      { segmentUid: 'same', reason: 'duplicate' },
      { segmentUid: 'same', reason: 'duplicate' }
    ]);
  });
});

describe('folding model result validation', () => {
  const input = { segmentUid: 'a', pageIndex: 0, source: 'First claim. Supporting evidence.', sentences: ['First claim.', 'Supporting evidence.'] };
  const good = { segment_uid: 'a', evidence: [0, 1], key: 'First claim. Supporting evidence.', takeaway: 'First claim.', topic: 'First claim' };

  it('builds Brief from original source and detects changed input', () => {
    const { results, failedSegmentUids } = validateFoldBatch([input], { segments: [good] });
    expect(failedSegmentUids).toEqual([]);
    expect(results[0].brief).toEqual(['First claim.', 'Supporting evidence.']);
    expect(foldResultMatchesSource(results[0], 'First claim. Supporting evidence.')).toBe(true);
    expect(foldResultMatchesSource(results[0], 'Changed claim.')).toBe(false);
  });

  it('rejects invented, repeated, out-of-order or duplicate evidence and incomplete layers', () => {
    for (const row of [
      { ...good, evidence: [99] }, { ...good, evidence: [0, 0] },
      { ...good, evidence: [1, 0] }, { ...good, topic: 'invented' },
      { ...good, key: 'Unrelated.' }
    ]) {
      expect(validateFoldBatch([input], { segments: [row] })).toEqual({ results: [], failedSegmentUids: ['a'] });
    }
    expect(validateFoldBatch([input], { segments: [good, good] }).failedSegmentUids).toEqual(['a']);
    expect(validateFoldBatch([input], { segments: [] }).failedSegmentUids).toEqual(['a']);
  });
});
