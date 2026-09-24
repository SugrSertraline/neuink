import { describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSegment } from '@/shared/types/domain';
import { buildPaperReferenceIndex } from './paperReferenceIndex';
import type { NativePdfLink } from './pdfDestinations';
import { findPdfReferenceFallback, resolvePdfReference } from './pdfReferenceFallback';

const segment = (uid: string, text: string): SourceSegment => ({ uid, text, markdown: null, page_idx: 4, bbox: [40, 100, 900, 200], segment_type: 'paragraph' });
const index = buildPaperReferenceIndex([segment('heading', 'References'), segment('r1', '[1] First source'), segment('r2', '[2] Second source')]);
const link: NativePdfLink = { id: 'link', dest: 'cite.author2026', label: '文内引用', rect: [.1, .1, .2, .2] };
const find = (text: string, native = link) => findPdfReferenceFallback(native, index, [], text);

describe('broken native PDF reference fallback', () => {
  it('uses visible citation digits or an explicit label, without guessing destination names', () => {
    expect(findPdfReferenceFallback(link, index, [find('[1]')!], '1')?.targets[0].segmentUid).toBe('r1');
    expect(find('[ 2 ]')?.targets[0].segmentUid).toBe('r2');
    expect(find('', { ...link, label: '[1]' })?.targets[0].segmentUid).toBe('r1');
    expect(find('', { ...link, dest: 'cite.1' })).toBeNull();
    expect(find('1')).toBeNull();
  });
  it('preserves grouped targets and refuses unknown or ambiguous neighboring references', () => {
    const grouped = find('[1, 2]')!;
    expect(grouped.targets.map(target => target.segmentUid)).toEqual(['r1', 'r2']);
    expect(findPdfReferenceFallback(link, index, [grouped], '8')).toBeNull();
    expect(findPdfReferenceFallback(link, index, [find('[1]')!, find('[2]')!], '')).toBeNull();
    expect(findPdfReferenceFallback(link, index, [grouped, grouped], '')?.targets).toEqual(grouped.targets);
  });
  it('uses the native destination first, even when the parsed target is different', async () => {
    const pdf = { numPages: 2, getDestination: vi.fn().mockResolvedValue([0, { name: 'Fit' }]),
      getPage: vi.fn().mockResolvedValue({ getViewport: () => ({}) }) } as unknown as PDFDocumentProxy;
    const fallback = vi.fn(() => find('[1]'));
    expect(await resolvePdfReference(pdf, link, fallback)).toEqual({ kind: 'native', target: { pageIdx: 0 } });
    expect(fallback).not.toHaveBeenCalled();
  });
  it('recovers a missing PDF destination using the existing bibliography', async () => {
    const pdf = { getDestination: vi.fn().mockResolvedValue(null) } as unknown as PDFDocumentProxy;
    expect(await resolvePdfReference(pdf, link, () => find('[1]'))).toMatchObject({ kind: 'indexed', reference: { targets: [{ segmentUid: 'r1', pageIdx: 4 }] } });
    await expect(resolvePdfReference(pdf, link, () => null)).rejects.toThrow('内置链接无法定位');
  });
  it('uses the figure context when its linked digit is also a bibliography number', () => {
    const figure = { ...segment('f1', 'Figure 1. Results'), segment_type: 'figure' as const };
    const refs = buildPaperReferenceIndex([figure, segment('h', 'References'), segment('r1', '[1] First source')]);
    const native = { ...link, label: 'Figure 1' };
    expect(findPdfReferenceFallback(native, refs, [], '1')?.targets[0].segmentUid).toBe('f1');
  });
});
