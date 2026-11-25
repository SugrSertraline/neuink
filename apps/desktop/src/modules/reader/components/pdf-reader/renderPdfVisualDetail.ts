import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSegment } from '@/shared/types/domain';
import { normalizeBbox } from './readerUtils';

/** Render only the requested region, with enough pixels for inspection and a bounded canvas. */
export async function renderPdfVisualDetail(pdf: PDFDocumentProxy, segment: SourceSegment, signal: AbortSignal) {
  const bbox = normalizeBbox(segment.bbox);
  if (!bbox || signal.aborted) throw new Error('PDF region unavailable.');
  const page = await pdf.getPage(segment.page_idx + 1);
  if (signal.aborted) throw new Error('PDF detail cancelled.');
  const base = page.getViewport({ scale: 1 });
  const left = Math.max(0, bbox[0] / 1000 * base.width - 4);
  const top = Math.max(0, bbox[1] / 1000 * base.height - 4);
  const width = Math.min(base.width, bbox[2] / 1000 * base.width + 4) - left;
  const height = Math.min(base.height, bbox[3] / 1000 * base.height + 4) - top;
  if (width <= 0 || height <= 0) throw new Error('PDF region is empty.');
  const scale = Math.min(4, 2560 / width, 2560 / height, Math.sqrt(4_000_000 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create PDF detail canvas.');
  const task = page.render({ canvas, canvasContext: context, viewport: page.getViewport({ scale }),
    transform: [1, 0, 0, 1, -left * scale, -top * scale] });
  const cancel = () => task.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await task.promise;
    if (signal.aborted) throw new Error('PDF detail cancelled.');
    return canvas.toDataURL('image/png');
  } finally {
    signal.removeEventListener('abort', cancel);
    canvas.width = 0;
    canvas.height = 0;
  }
}
