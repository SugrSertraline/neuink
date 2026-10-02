import { describe, expect, it } from 'vitest';
import { layoutTranslatedParagraphs } from './translationLayout';
import type { PageSegments, SegmentRegionItem } from './types';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
function region(id: string, bbox: SegmentRegionItem['bbox'], type: SegmentRegionItem['segment']['segment_type'] = 'paragraph'): SegmentRegionItem {
  const segment: SegmentRegionItem['segment'] = { uid: id, bbox: [...bbox], page_idx: 0, segment_type: type, text: id, markdown: id };
  return { id, bbox, segment, sourceSegment: segment, hoverGroupUid: id, isContinuation: false, relationGroupUid: null, pageIdx: 0 };
}
const a = region('a', [50, 50, 450, 150]), b = region('b', [50, 160, 450, 260]);
const translations = new Map<string, TranslatedSegment>([a, b].map((r, i) => [r.id, { segment_uid: r.id, source_hash: '', source_text: r.id, translated_text: i ? '长译文'.repeat(100) : '短译文', status: 'translated', segment_type: 'paragraph', page_idx: 0, updated_at: '', error: null }]));
const page = (regions: SegmentRegionItem[]): PageSegments => ({ pageIdx: 0, regions, segments: regions.map(r => r.segment) });
describe('translation layout boundaries', () => {
  it('lends short paragraph space to the next long paragraph without changing source boxes', () => {
    const placements = layoutTranslatedParagraphs(page([a, b]), translations);
    expect(placements.get('a')!.bbox[3]).toBeLessThan(150);
    expect(placements.get('b')!.bbox[1]).toBeLessThan(160);
    expect(placements.get('b')!.bbox[3]).toBe(260);
    expect(a.bbox).toEqual([50, 50, 450, 150]);
    expect(placements.get('a')!.bbox[3]).toBeLessThan(placements.get('b')!.bbox[1]);
  });
  it.each(['figure', 'math', 'table', 'heading'] as const)('does not cross a %s boundary', type => {
    const barrier = region('barrier', [60, 150, 430, 160], type);
    expect(layoutTranslatedParagraphs(page([a, barrier, b]), translations).size).toBe(0);
  });
  it('does not cross columns, missing translations, or large gaps', () => {
    expect(layoutTranslatedParagraphs(page([a, { ...b, bbox: [550, 160, 950, 260] }]), translations).size).toBe(0);
    expect(layoutTranslatedParagraphs(page([a, b]), new Map([['a', translations.get('a')!]])).size).toBe(0);
    expect(layoutTranslatedParagraphs(page([a, { ...b, bbox: [50, 250, 450, 350] }]), translations).size).toBe(0);
  });
});
