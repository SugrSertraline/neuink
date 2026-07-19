import type { PDFDocumentProxy } from 'pdfjs-dist';

import type { SourceSegment } from '@/shared/types/domain';

import { normalizeBbox } from '../pdf-reader/readerUtils';

const PAGE_RENDER_WIDTH = 980;
const SNAPSHOT_PADDING = 16;
const MAX_SNAPSHOT_WIDTH = 760;
const MAX_PAGE_SNAPSHOTS_PER_DOCUMENT = 3;
const MAX_SEGMENT_SNAPSHOTS_PER_DOCUMENT = 24;

type RenderedPageSnapshot = {
  canvas: HTMLCanvasElement;
  height: number;
  width: number;
};

const pageSnapshotCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<RenderedPageSnapshot>>>();
const segmentSnapshotCache = new WeakMap<PDFDocumentProxy, Map<string, Promise<string | null>>>();

export function readCachedPdfSegmentSnapshot(
  pdfDocument: PDFDocumentProxy | null,
  segment: SourceSegment
) {
  if (!pdfDocument || !segment.bbox) {
    return Promise.resolve(null);
  }

  let snapshots = segmentSnapshotCache.get(pdfDocument);
  if (!snapshots) {
    snapshots = new Map();
    segmentSnapshotCache.set(pdfDocument, snapshots);
  }

  const key = `${segment.uid}:${segment.page_idx}:${segment.bbox.join(',')}`;
  const existing = snapshots.get(key);
  if (existing) {
    snapshots.delete(key);
    snapshots.set(key, existing);
    return existing;
  }

  const snapshot = cropSegmentSnapshot(pdfDocument, segment)
    .catch(() => null)
    .then((url) => {
      if (!url && snapshots?.get(key) === snapshot) snapshots.delete(key);
      return url;
    });
  snapshots.set(key, snapshot);
  trimSegmentSnapshots(snapshots);
  return snapshot;
}

export function warmCachedPdfSegmentSnapshot(
  pdfDocument: PDFDocumentProxy | null,
  segment: SourceSegment
) {
  if (!pdfDocument || !segment.bbox) {
    return;
  }
  void readCachedPdfSegmentSnapshot(pdfDocument, segment);
}

async function cropSegmentSnapshot(pdfDocument: PDFDocumentProxy, segment: SourceSegment) {
  const bbox = normalizeBbox(segment.bbox);
  if (!bbox || typeof document === 'undefined') {
    return null;
  }

  const page = await readCachedPageSnapshot(pdfDocument, segment.page_idx);
  const [x0, y0, x1, y1] = bbox;
  const scaleX = page.width / 1000;
  const scaleY = page.height / 1000;
  const left = Math.max(0, Math.floor(x0 * scaleX) - SNAPSHOT_PADDING);
  const top = Math.max(0, Math.floor(y0 * scaleY) - SNAPSHOT_PADDING);
  const right = Math.min(page.width, Math.ceil(x1 * scaleX) + SNAPSHOT_PADDING);
  const bottom = Math.min(page.height, Math.ceil(y1 * scaleY) + SNAPSHOT_PADDING);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const outputScale = Math.min(1, MAX_SNAPSHOT_WIDTH / width);
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.floor(width * outputScale));
  output.height = Math.max(1, Math.floor(height * outputScale));
  const context = output.getContext('2d');
  if (!context) {
    return null;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    page.canvas,
    left,
    top,
    width,
    height,
    0,
    0,
    output.width,
    output.height
  );
  return output.toDataURL('image/png');
}

function readCachedPageSnapshot(pdfDocument: PDFDocumentProxy, pageIdx: number) {
  let pages = pageSnapshotCache.get(pdfDocument);
  if (!pages) {
    pages = new Map();
    pageSnapshotCache.set(pdfDocument, pages);
  }

  const existing = pages.get(pageIdx);
  if (existing) {
    pages.delete(pageIdx);
    pages.set(pageIdx, existing);
    return existing;
  }

  const rendered = renderPageSnapshot(pdfDocument, pageIdx).catch((error) => {
    if (pages?.get(pageIdx) === rendered) pages.delete(pageIdx);
    throw error;
  });
  pages.set(pageIdx, rendered);
  trimPageSnapshots(pages);
  return rendered;
}

function trimSegmentSnapshots(snapshots: Map<string, Promise<string | null>>) {
  while (snapshots.size > MAX_SEGMENT_SNAPSHOTS_PER_DOCUMENT) {
    const oldestKey = snapshots.keys().next().value;
    if (typeof oldestKey !== 'string') return;
    snapshots.delete(oldestKey);
  }
}

function trimPageSnapshots(pages: Map<number, Promise<RenderedPageSnapshot>>) {
  while (pages.size > MAX_PAGE_SNAPSHOTS_PER_DOCUMENT) {
    const oldestKey = pages.keys().next().value;
    if (typeof oldestKey !== 'number') return;
    const evicted = pages.get(oldestKey);
    pages.delete(oldestKey);
    void evicted?.then((snapshot) => {
      window.setTimeout(() => {
        snapshot.canvas.width = 0;
        snapshot.canvas.height = 0;
      }, 1000);
    });
  }
}

async function renderPageSnapshot(
  pdfDocument: PDFDocumentProxy,
  pageIdx: number
): Promise<RenderedPageSnapshot> {
  const page = await pdfDocument.getPage(pageIdx + 1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = PAGE_RENDER_WIDTH / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to create PDF snapshot canvas context.');
  }

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({
    canvas,
    canvasContext: context,
    viewport
  }).promise;

  return {
    canvas,
    height: canvas.height,
    width: canvas.width
  };
}
