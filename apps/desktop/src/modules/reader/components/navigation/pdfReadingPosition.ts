import type { ReadingPosition } from './ReadingNavigation';

export function capturePdfReadingPosition(container: HTMLDivElement | null): ReadingPosition | null {
  if (!container || container.getBoundingClientRect().width <= 0) return null;
  const top = container.getBoundingClientRect().top;
  const page = Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-page-index]'))
    .find(page => { const rect = page.getBoundingClientRect(); return rect.height > 0 && rect.bottom > top + 1; });
  if (!page) return null;
  const rect = page.getBoundingClientRect();
  const segments = [...page.querySelectorAll<HTMLElement>('[data-segment-uid]')]
    .filter(node => node.getBoundingClientRect().height > 0);
  const segment = segments.find(node => {
    const bounds = node.getBoundingClientRect(); return bounds.top <= top + 24 && bounds.bottom > top;
  }) ?? segments.find(node => node.getBoundingClientRect().bottom > top) ?? segments[segments.length - 1];
  const bounds = segment?.getBoundingClientRect();
  return { pageIdx: Number(page.dataset.pdfPageIndex), offset: (top - rect.top) / rect.height, left: container.scrollLeft,
    ...(segment && bounds ? { segmentUid: segment.dataset.segmentUid, segmentOffset: (top - bounds.top) / bounds.height } : {}) };
}

export function restorePdfReadingPosition(container: HTMLDivElement, position: ReadingPosition) {
  const page = Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-page-index]'))
    .find(page => Number(page.dataset.pdfPageIndex) === position.pageIdx);
  if (!page) return;
  const rect = page.getBoundingClientRect(), bounds = container.getBoundingClientRect();
  if (rect.height <= 0 || bounds.width <= 0) return;
  const scale = bounds.width / (container.offsetWidth || bounds.width) || 1;
  const segment = position.segmentUid ? [...page.querySelectorAll<HTMLElement>('[data-segment-uid]')].find(node => node.dataset.segmentUid === position.segmentUid) : undefined;
  const segmentRect = segment?.getBoundingClientRect();
  const segmentOffset = position.sourceKind === 'reflow' ? Math.max(0, Math.min(1, position.segmentOffset ?? 0)) : position.segmentOffset;
  const offset = segmentRect && segmentOffset !== undefined ? segmentRect.top - bounds.top + segmentOffset * segmentRect.height
    : rect.top - bounds.top + (position.sourceKind === 'reflow' ? 0 : position.offset) * rect.height;
  container.scrollTo({ top: container.scrollTop + offset / scale,
    left: position.left, behavior: 'auto' });
}
