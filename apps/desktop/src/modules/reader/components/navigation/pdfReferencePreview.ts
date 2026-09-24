import type { SourceSegment } from '@/shared/types/domain';
import type { PaperReference, ReferenceIndex } from './paperReferenceIndex';
import type { PdfTextReference } from './pdfTextReferences';
import type { ReadingTarget } from './ReadingNavigation';

/** A PDF destination is a point/strip in a page, not a position in parser reading order. */
export function findPdfReferencePreview(target: ReadingTarget, source: PdfTextReference | null,
  index: ReferenceIndex, segments: SourceSegment[]): PaperReference | null {
  const nearby = (reference: ReadingTarget) => {
    if (reference.pageIdx !== target.pageIdx) return false;
    if (!target.rect) return true;
    if (!reference.rect) return false;
    const [x, y, right, bottom] = target.rect;
    const box = reference.rect;
    // FitH/XYZ-null-x retain a full-width strip; do not pretend they point to the left column.
    const xMatches = right - x >= 999 || (x >= box[0] - 8 && x <= box[2] + 8);
    const yMatches = bottom - y >= 999 || (y >= box[1] - 12 && y <= box[3] + 5);
    return xMatches && yMatches;
  };
  if (source) {
    const candidates = source.targets.filter(nearby);
    // A known citation must never preview another number merely because it is nearby.
    return candidates.length === 1 ? candidates[0] : null;
  }
  if (!target.rect) return null;
  const references = [...index.values()].filter((value): value is PaperReference => Boolean(value));
  const candidates = [...new Map(references.filter(nearby).map(value => [`${value.segmentUid}:${value.label}`, value])).values()];
  if (candidates.length) return candidates.length === 1 ? candidates[0] : null;

  const bodies = segments.filter(segment => segment.bbox && nearby({ pageIdx: segment.page_idx, rect: segment.bbox })
    && !references.some(reference => reference.segmentUid === segment.uid));
  if (bodies.length > 1 && (target.rect[2] - target.rect[0] >= 999 || target.rect[3] - target.rect[1] >= 999)) return null;
  const area = (segment: SourceSegment) => (segment.bbox![2] - segment.bbox![0]) * (segment.bbox![3] - segment.bbox![1]);
  bodies.sort((a, b) => area(a) - area(b));
  if (!bodies.length || (bodies.length > 1 && area(bodies[0]) === area(bodies[1]))) return null;
  const segment = bodies[0];
  return { ...target, segmentUid: segment.uid, segment, label: '文内引用', text: segment.markdown || segment.text };
}
