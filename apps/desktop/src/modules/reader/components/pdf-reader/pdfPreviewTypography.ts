import { normalizePdfPreviewFontSize, type PdfHoverPreviewFontSize } from '@/shared/lib/readerPreferences';

/** Sentence and whole-block previews use the same saved percentage and baseline. */
export function pdfPreviewTextMetrics(size: PdfHoverPreviewFontSize = 100) {
  const scale = normalizePdfPreviewFontSize(size) / 100;
  return { fontSize: 13 * scale, lineHeight: 21 * scale };
}
