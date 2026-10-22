import type { Annotation, AnnotationImportance, AnnotationTextSelection, SourceSegment } from '@/shared/types/domain';
import type { PdfAnnotationDraft } from './usePdfAnnotationActions';

export type TextSelectionAnnotationInput = {
  content: string;
  contentMode?: 'append';
  importance: AnnotationImportance;
  segment: SourceSegment;
  selection: AnnotationTextSelection;
};

// A false result keeps the selection and its draft available for retry.
export type ApplyTextSelectionAnnotation = (input: TextSelectionAnnotationInput) => Promise<void | boolean> | void | boolean;

export function textSelectionAnnotationDraft(input: TextSelectionAnnotationInput, annotations: Annotation[]): PdfAnnotationDraft {
  const { contentMode, importance, segment, selection } = input;
  const existing = annotations.find(annotation => annotation.segment_uid === segment.uid && sameTextSelection(annotation.text_selection, selection));
  const content = input.content.trim();
  const previous = existing?.content ?? '';
  const alreadyAppended = previous.trimEnd() === content || previous.trimEnd().endsWith(`\n\n${content}`);
  return {
    annotationId: existing?.annotation_id,
    content: contentMode === 'append' && previous.trim() && content
      ? alreadyAppended ? previous : `${previous.trimEnd()}\n\n${content}`
      : content || previous,
    importance: contentMode === 'append' || !content ? existing?.importance ?? importance : importance,
    kind: 'highlight',
    segmentUid: segment.uid,
    textSelection: selection,
  };
}

function sameTextSelection(left: AnnotationTextSelection | null | undefined, right: AnnotationTextSelection) {
  if (!left || left.page_idx !== right.page_idx || left.text.trim() !== right.text.trim() || left.rects.length !== right.rects.length) return false;
  // Normalized PDF edges can shift by one unit after font rounding at a new zoom.
  return left.rects.every((rect, index) => rect.every((coordinate, coordinateIndex) =>
    Math.abs(coordinate - right.rects[index][coordinateIndex]) <= 1));
}
