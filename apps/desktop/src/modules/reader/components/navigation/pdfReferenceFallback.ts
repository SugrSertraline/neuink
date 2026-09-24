import type { PDFDocumentProxy } from 'pdfjs-dist';
import { matchPaperReferences, type ReferenceIndex } from './paperReferenceIndex';
import { resolvePdfDestination, type NativePdfLink } from './pdfDestinations';
import type { PdfTextReference } from './pdfTextReferences';
import type { ReadingTarget } from './ReadingNavigation';

export function referenceRectsOverlap(a: readonly number[], b: readonly number[]) {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/** Match the visible citation, never a number guessed from an opaque PDF destination name. */
export function findPdfReferenceFallback(link: NativePdfLink, index: ReferenceIndex,
  textLinks: PdfTextReference[], linkedText: string): PdfTextReference | null {
  const overlapping = textLinks.filter(text => referenceRectsOverlap(text.rect, link.rect));
  const identity = (text: PdfTextReference) => text.targets.map(target => `${target.segmentUid}:${target.label}`).join('|');
  const unique = (candidates: PdfTextReference[]) => candidates.length && candidates.every(text => identity(text) === identity(candidates[0]))
    ? { ...candidates[0], rect: link.rect } : null;
  const exact = (text: string): PdfTextReference | null => {
    const matches = matchPaperReferences(text, index);
    return matches.length === 1 && matches[0].label === text ? { label: text, targets: matches[0].targets, rect: link.rect } : null;
  };
  const label = linkedText.replace(/\s+/g, ' ').trim();
  const annotation = exact(link.label.trim());
  if (/^\d+(?:\s*[,;–—-]\s*\d+)*$/.test(label)) {
    // Bare digits need citation context: otherwise a broken section/page link
    // could incorrectly select an unrelated bibliography entry with that number.
    const numeric = exact(`[${label}]`);
    const context = annotation ? [...overlapping, annotation] : overlapping;
    if (numeric && context.some(candidate => numeric.targets.every(target => candidate.targets.some(
      other => other.segmentUid === target.segmentUid && other.label === target.label)))) return numeric;
    return unique(context.filter(candidate => candidate.targets.every(target => !target.label.startsWith('['))));
  }
  const visible = exact(label);
  if (visible) return visible;
  if (/^[\[［].*[\]］]$/.test(label)) return null;
  return annotation ?? unique(overlapping);
}

export type PdfReferenceDestination =
  | { kind: 'native'; target: ReadingTarget }
  | { kind: 'indexed'; reference: PdfTextReference };

export async function resolvePdfReference(document: PDFDocumentProxy, link: NativePdfLink,
  fallback: () => PdfTextReference | null): Promise<PdfReferenceDestination> {
  try {
    return { kind: 'native', target: await resolvePdfDestination(document, link.dest) };
  } catch {
    const reference = fallback();
    if (reference) return { kind: 'indexed', reference };
    throw new Error('PDF 内置链接无法定位，暂未匹配到对应原文。可在文内查找引用编号，或待文字加载后重试。');
  }
}
