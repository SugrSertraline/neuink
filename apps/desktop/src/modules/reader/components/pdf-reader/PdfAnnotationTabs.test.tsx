/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import type { Annotation } from '@/shared/types/domain';
import { annotationsForPage } from './PdfAnnotationTabs';
import { groupSegmentsByPage } from './readerUtils';
import { annotationPaperProps } from '@/modules/annotations/annotationPaper';

const annotation: Annotation = { annotation_id: 'note', segment_uid: 'pdf-page:1', anchor_kind: 'pdf_page',
  content: 'Evidence', importance: 'normal', kind: 'comment', created_at: '', updated_at: '',
  text_selection: { color: 'green', page_idx: 1, text: 'Selected text', rects: [[0, 0, 100, 100]] } };
describe('page annotation slips', () => {
  it('finds unparsed PDF annotations, deduplicates aliases and keeps the original anchor', () => {
    const pages = groupSegmentsByPage([], 3);
    const map = new Map([['pdf-page:1', [annotation]], ['alias', [annotation]]]);
    const result = annotationsForPage(pages[1], map);
    expect(result).toHaveLength(1);
    expect(result[0].segment.uid).toBe('pdf-page:1');
    expect(result[0].annotation).toBe(annotation);
    expect(annotationsForPage(pages[0], map)).toEqual([]);
    expect(annotationsForPage(pages[1], new Map())).toEqual([]);
  });
  it('derives sticky-paper color from the persisted highlight without changing annotation data', () => {
    expect(annotationPaperProps(annotation)['data-paper-color']).toBe('green');
    expect(annotationPaperProps({importance:'core'})['data-paper-color']).toBe('pink');
    expect(annotationPaperProps({importance:'normal'})['data-paper-color']).toBe('yellow');
  });
});
