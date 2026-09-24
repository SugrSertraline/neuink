import { describe, expect, it } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import { buildPaperReferenceIndex, matchPaperReferences } from './paperReferenceIndex';
import { findPdfReferencePreview } from './pdfReferencePreview';
import type { PdfTextReference } from './pdfTextReferences';

const entry = (uid: string, text: string, bbox: SourceSegment['bbox'], extra: Partial<SourceSegment> = {}): SourceSegment =>
  ({ uid, text, markdown: null, bbox, page_idx: 7, segment_type: 'paragraph', sub_type: 'reference', ...extra });
const left = entry('left', '[1] The left-column source', [60, 200, 430, 280]);
const right = entry('right', '[12] The right-column source', [560, 200, 930, 280]);
const segments = [left, right], index = buildPaperReferenceIndex(segments);
const source = (label: string, refs = index): PdfTextReference => ({ ...matchPaperReferences(label, refs)[0], rect: [0, 0, .1, .1] });

describe('PDF reference preview identity and column geometry', () => {
  it.each([segments, [...segments].reverse()])('chooses the right column at equal y regardless of parser order', (...sources) => {
    const target = { pageIdx: 7, rect: [565, 200, 585, 220] as const };
    expect(findPdfReferencePreview(target, null, index, sources)?.text).toBe(right.text);
    expect(findPdfReferencePreview(target, source('[12]'), index, sources)?.label).toBe('[12]');
  });
  it('uses actual column bounds, including unequal widths, instead of dividing the page in half', () => {
    const narrow = entry('narrow', '[3] Narrow column', [40, 300, 260, 340]);
    const wide = entry('wide', '[4] Wide column', [310, 300, 950, 340]);
    const refs = buildPaperReferenceIndex([narrow, wide]);
    expect(findPdfReferencePreview({ pageIdx: 7, rect: [320, 300, 340, 320] }, null, refs, [narrow, wide])?.text).toBe(wide.text);
  });
  it('matches only the requested number inside a merged bibliography block', () => {
    const block = entry('merged', '[12] First in the right column\n[13] Second in the right column', [560, 200, 930, 450]);
    const refs = buildPaperReferenceIndex([left, block]);
    const target = { pageIdx: 7, rect: [565, 300, 585, 320] as const };
    expect(findPdfReferencePreview(target, source('[13]', refs), refs, [left, block])?.text).toBe('[13] Second in the right column');
    expect(findPdfReferencePreview(target, null, refs, [left, block])).toBeNull();
  });
  it('does not substitute another number when the printed citation conflicts with native coordinates', () => {
    expect(findPdfReferencePreview({ pageIdx: 7, rect: [65, 200, 85, 220] }, source('[12]'), index, segments)).toBeNull();
    expect(findPdfReferencePreview({ pageIdx: 6, rect: [565, 200, 585, 220] }, source('[12]'), index, segments)).toBeNull();
  });
  it('requires an explicit citation to disambiguate a destination without a column', () => {
    const target = { pageIdx: 7, rect: [0, 200, 1000, 220] as const };
    expect(findPdfReferencePreview(target, null, index, segments)).toBeNull();
    expect(findPdfReferencePreview(target, source('[12]'), index, segments)?.text).toBe(right.text);
  });
  it('applies the same horizontal check when only unindexed source blocks exist', () => {
    expect(findPdfReferencePreview({ pageIdx: 7, rect: [565, 200, 585, 220] }, null, new Map(), segments)?.segmentUid).toBe('right');
    const wider = { ...right, bbox: [500, 200, 950, 300] as SourceSegment['bbox'] };
    expect(findPdfReferencePreview({ pageIdx: 7, rect: [0, 200, 1000, 220] }, null, new Map(), [left, wider])).toBeNull();
  });
});
