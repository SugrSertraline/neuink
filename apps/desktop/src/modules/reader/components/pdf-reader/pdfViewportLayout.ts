export function centeredPdfScrollLeft(scrollWidth: number, clientWidth: number) {
  const overflowWidth = Math.max(0, scrollWidth - clientWidth);
  return overflowWidth <= 1 ? 0 : overflowWidth / 2;
}

type AxisAnchor = { fraction: number; gap: number };
export type PdfZoomAnchor = { paper: HTMLElement; x: AxisAnchor; y: AxisAnchor };
export type PdfZoomScroll = { left: number; top: number };

// Captions, borders, gutters and the navigation rail do not scale with the PDF.
// Measure the paper itself and convert screen coordinates to CSS scroll pixels.
function viewportCenter(container: HTMLDivElement, leftInset: number) {
  const bounds = container.getBoundingClientRect();
  if (bounds.width <= 0 || container.clientWidth <= 0 || container.clientHeight <= 0) return null;
  const scale = bounds.width / (container.offsetWidth || bounds.width);
  return { scale,
    x: bounds.left + (container.clientLeft + (container.clientWidth + leftInset) / 2) * scale,
    y: bounds.top + (container.clientTop + container.clientHeight / 2) * scale };
}

function captureAxis(point: number, start: number, length: number, scale: number): AxisAnchor {
  const fraction = Math.max(0, Math.min(1, (point - start) / length));
  return { fraction, gap: (point - start - fraction * length) / scale };
}

export function capturePdfZoomAnchor(container: HTMLDivElement | null, leftInset: number): PdfZoomAnchor | null {
  if (!container) return null;
  const center = viewportCenter(container, leftInset);
  if (!center) return null;
  let nearest: { paper: HTMLElement; rect: DOMRect; distance: number } | null = null;
  for (const paper of container.querySelectorAll<HTMLElement>('[data-pdf-page-index] [data-guide="pdf-page"]')) {
    const rect = paper.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const dx = Math.max(rect.left - center.x, 0, center.x - rect.right);
    const dy = Math.max(rect.top - center.y, 0, center.y - rect.bottom);
    const distance = dx * dx + dy * dy;
    if (!nearest || distance < nearest.distance) nearest = { paper, rect, distance };
  }
  if (!nearest) return null;
  const { paper, rect } = nearest;
  return { paper,
    x: captureAxis(center.x, rect.left, rect.width, center.scale),
    y: captureAxis(center.y, rect.top, rect.height, center.scale) };
}

export function restorePdfZoomAnchor(container: HTMLDivElement, anchor: PdfZoomAnchor, leftInset: number) {
  if (!container.contains(anchor.paper)) return;
  const center = viewportCenter(container, leftInset);
  const rect = anchor.paper.getBoundingClientRect();
  if (!center || rect.width <= 0 || rect.height <= 0) return;
  const left = container.scrollLeft + (rect.left + anchor.x.fraction * rect.width - center.x) / center.scale + anchor.x.gap;
  const top = container.scrollTop + (rect.top + anchor.y.fraction * rect.height - center.y) / center.scale + anchor.y.gap;
  container.scrollTo({ left, top, behavior: 'instant' });
  return { left: container.scrollLeft, top: container.scrollTop };
}
