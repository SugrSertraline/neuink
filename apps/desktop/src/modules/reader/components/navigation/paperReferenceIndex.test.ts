import { describe, expect, it } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import { buildPaperReferenceIndex, matchPaperReferences } from './paperReferenceIndex';
const segment = (uid: string, text: string, extra: Partial<SourceSegment> = {}): SourceSegment => ({ uid, text, markdown: null, bbox: null, page_idx: 0, segment_type: 'paragraph', ...extra });
describe('paper references', () => {
  it('resolves captions to their visual body and preserves source assets', () => {
    const body = segment('figure', '', { segment_type: 'figure', visual_group_id: 'v', asset_path: 'images/plot.png' });
    const index = buildPaperReferenceIndex([body, segment('caption', 'Figure 3. The result', { block_role: 'caption', visual_group_id: 'v' })]);
    const matches = matchPaperReferences('See Fig. 3 and Table 8.', index);
    expect(matches).toHaveLength(1); expect(matches[0].targets[0].segment.uid).toBe('figure');
    expect(matches[0].targets[0].segment.asset_path).toBe('images/plot.png');
  });
  it('supports numbered reference lists, groups and bounded ranges', () => {
    const index = buildPaperReferenceIndex([segment('h', 'References', { segment_type: 'heading' }), segment('r', '[1] One\n[2] Two\n[3] Three')]);
    expect(matchPaperReferences('Compare [1, 3] and [1–3].', index).map(m => m.targets.length)).toEqual([2,3]);
    expect(matchPaperReferences('[1, 8] [1-2000] [3-1]', index)).toEqual([]);
    expect(index.get('citation:2')?.text).toBe('[2] Two');
  });
  it('does not turn arbitrary array numbers or prose into destinations', () => {
    expect(buildPaperReferenceIndex([segment('p', '[12] samples were collected. Figure 3 is useful.')]).size).toBe(0);
  });
  it('leaves conflicting figure labels unresolved', () => {
    const index = buildPaperReferenceIndex([segment('a', 'Figure 1. A', { segment_type: 'figure' }), segment('b', 'Figure 1. B', { segment_type: 'figure' })]);
    expect(matchPaperReferences('Figure 1', index)).toEqual([]);
  });
  it('supports equations, supplementary figures and Chinese labels', () => {
    const index = buildPaperReferenceIndex([segment('e', '$$ x=1 \\tag{2} $$', { segment_type: 'math' }), segment('f', 'Figure S1. Test', { segment_type: 'figure' }), segment('t', '表 4 结果', { segment_type: 'table' })]);
    expect(matchPaperReferences('Eq. (2), Fig. S1 和表4', index).map(m => m.targets[0].segmentUid)).toEqual(['e','f','t']);
  });
  it('accepts numbered bibliography headings but rejects partial identifiers', () => {
    const index = buildPaperReferenceIndex([segment('f', 'Figure 3. Results', {segment_type:'figure'}),
      segment('h', '7 参考文献', {segment_type:'heading'}), segment('r', '[1] A real source')]);
    expect(matchPaperReferences('[1]', index)).toHaveLength(1);
    expect(matchPaperReferences('Figure 30 Figure 3abc Figure 3a', index)).toHaveLength(0);
  });
  it('recognizes a misclassified bibliography heading and escaped or styled reference numbers', () => {
    const index = buildPaperReferenceIndex([segment('h', '**References**'),
      segment('r1', '\\[12\\] Escaped source'), segment('r2', '**[13]** Bold source'), segment('r3', '［14］ Fullwidth source')]);
    expect(matchPaperReferences('[ 12 ] [13] ［14］', index).map(m => m.targets[0].segmentUid)).toEqual(['r1', 'r2', 'r3']);
    expect(matchPaperReferences('[15]', index)).toEqual([]);
  });
  it('binds bibliography item coordinates by number across columns and pages, not array order', () => {
    const left = { text: '[1] Left source', bbox: [60, 200, 430, 280], page_idx: 7 };
    const right = { text: '[12] Right source', bbox: [560, 200, 930, 280], page_idx: 8 };
    const index = buildPaperReferenceIndex([segment('refs', '[1] Left source\n[12] Right source', {
      sub_type: 'reference', segment_type: 'list', page_idx: 7, bbox: [60, 200, 930, 1280],
      mineru_metadata: { list_item_regions: JSON.stringify([right, left]) }
    })]);
    expect(index.get('citation:1')).toMatchObject({ rect: left.bbox, pageIdx: 7, text: left.text });
    expect(index.get('citation:12')).toMatchObject({ rect: right.bbox, pageIdx: 8, text: right.text, segmentUid: 'refs' });
  });
  it('leaves conflicting numbers in a merged bibliography unresolved', () => {
    const index = buildPaperReferenceIndex([segment('refs', '[1] A\n[1] B', { sub_type: 'reference' })]);
    expect(index.get('citation:1')).toBeNull();
  });
});
