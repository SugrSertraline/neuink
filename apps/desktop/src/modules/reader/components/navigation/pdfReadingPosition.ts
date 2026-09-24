import type { ReadingPosition } from './ReadingNavigation';

export function capturePdfReadingPosition(container: HTMLDivElement | null): ReadingPosition | null {
  if (!container || container.getBoundingClientRect().width <= 0) return null;
  const top = container.getBoundingClientRect().top;
  const page = Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-page-index]'))
    .find(page => { const rect = page.getBoundingClientRect(); return rect.height > 0 && rect.bottom > top + 1; });
  if (!page) return null;
  const rect = page.getBoundingClientRect();
  return { pageIdx: Number(page.dataset.pdfPageIndex), offset: (top - rect.top) / rect.height, left: container.scrollLeft };
}

export function restorePdfReadingPosition(container: HTMLDivElement, position: ReadingPosition) {
  const page = Array.from(container.querySelectorAll<HTMLElement>('[data-pdf-page-index]'))
    .find(page => Number(page.dataset.pdfPageIndex) === position.pageIdx);
  if (!page) return;
  const rect = page.getBoundingClientRect(), bounds = container.getBoundingClientRect();
  if (rect.height <= 0 || bounds.width <= 0) return;
  const scale = bounds.width / (container.offsetWidth || bounds.width) || 1;
  container.scrollTo({ top: container.scrollTop + (rect.top - bounds.top + position.offset * rect.height) / scale,
    left: position.left, behavior: 'auto' });
}
