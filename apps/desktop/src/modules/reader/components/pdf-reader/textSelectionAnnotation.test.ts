import { describe, expect, it } from 'vitest';
import type { Annotation } from '@/shared/types/domain';
import { textSelectionAnnotationDraft, type TextSelectionAnnotationInput } from './textSelectionAnnotation';

const input: TextSelectionAnnotationInput = {
  content: '  译文第一行\n译文第二行  ', contentMode: 'append', importance: 'normal',
  segment: { uid: 'segment-1', page_idx: 0, segment_type: 'paragraph', text: 'source', markdown: null, bbox: null },
  selection: { page_idx: 0, text: 'source', rects: [[10, 20, 30, 40]], color: 'green' },
};
const existing: Annotation = {
  annotation_id: 'annotation-1', segment_uid: 'segment-1', kind: 'highlight', content: '已有阅读心得', importance: 'core',
  text_selection: input.selection, created_at: '', updated_at: '',
};

describe('translation highlight annotation draft', () => {
  it('creates a highlight with translated content and the exact source anchor', () => {
    expect(textSelectionAnnotationDraft(input, [])).toEqual({
      annotationId: undefined, kind: 'highlight', segmentUid: 'segment-1',
      content: '译文第一行\n译文第二行', importance: 'normal', textSelection: input.selection,
    });
  });

  it('appends to the same selection while preserving existing content and importance', () => {
    expect(textSelectionAnnotationDraft(input, [existing])).toMatchObject({
      annotationId: existing.annotation_id, content: '已有阅读心得\n\n译文第一行\n译文第二行', importance: 'core',
    });
    expect(existing.content).toBe('已有阅读心得');
  });

  it.each(['译文第一行\n译文第二行', '已有阅读心得\n\n译文第一行\n译文第二行'])('does not duplicate a translation already appended: %s', content => {
    expect(textSelectionAnnotationDraft(input, [{ ...existing, content }]).content).toBe(content);
  });

  it('fills an empty highlight and does not replace a different occurrence of the same text', () => {
    expect(textSelectionAnnotationDraft(input, [{ ...existing, content: '' }]).content).toBe(input.content.trim());
    const other = { ...existing, text_selection: { ...input.selection, rects: [[100, 200, 300, 400]] as [number, number, number, number][] } };
    expect(textSelectionAnnotationDraft(input, [other]).annotationId).toBeUndefined();
  });

  it('matches the same PDF word after selection edges are rounded at 125% UI zoom', () => {
    const original = { ...existing, text_selection: { ...input.selection, rects: [[406.32, 212.27, 433.55, 232.82]] as [number, number, number, number][] } };
    const zoomed = { ...input, selection: { ...input.selection, rects: [[406.23, 211.47, 433.45, 232.41]] as [number, number, number, number][] } };
    expect(textSelectionAnnotationDraft(zoomed, [original]).annotationId).toBe(existing.annotation_id);
  });

  it('keeps the existing manual annotation and plain highlight behavior', () => {
    expect(textSelectionAnnotationDraft({ ...input, contentMode: undefined }, [existing])).toMatchObject({
      content: input.content.trim(), importance: 'normal',
    });
    expect(textSelectionAnnotationDraft({ ...input, content: '', contentMode: undefined }, [existing])).toMatchObject({
      content: existing.content, importance: existing.importance,
    });
  });
});
