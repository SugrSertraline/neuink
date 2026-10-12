export type FloatingToolbarLayout = {
  left: number;
  maxHeight: number;
  maxWidth: number;
  placement: 'above' | 'below';
  top: number;
};

export function calculateFloatingToolbarLayout({
  anchor,
  contentHeight,
  contentWidth,
  cssScale = 1,
  viewport
}: {
  anchor: { bottom: number; left: number; right: number; top: number };
  contentHeight: number;
  contentWidth: number;
  cssScale?: number;
  viewport: { height: number; left: number; top: number; width: number };
}): FloatingToolbarLayout {
  const margin = 8;
  const gap = 8;
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const width = Math.min(contentWidth, Math.max(0, viewport.width - margin * 2));
  const left = clamp(
    (anchor.left + anchor.right - width) / 2,
    viewport.left + margin,
    Math.max(viewport.left + margin, viewportRight - margin - width)
  );
  const availableBelow = Math.max(0, viewportBottom - margin - anchor.bottom - gap);
  const availableAbove = Math.max(0, anchor.top - gap - (viewport.top + margin));
  const placement: FloatingToolbarLayout['placement'] =
    contentHeight <= availableBelow || (availableBelow >= availableAbove && contentHeight > availableAbove)
      ? 'below'
      : 'above';
  const availableHeight = placement === 'below' ? availableBelow : availableAbove;
  const maxHeight = Math.max(0, availableHeight);
  const visibleHeight = Math.min(contentHeight, maxHeight);
  const idealTop = placement === 'below'
    ? anchor.bottom + gap
    : anchor.top - gap - visibleHeight;
  const top = clamp(
    idealTop,
    viewport.top + margin,
    Math.max(viewport.top + margin, viewportBottom - margin - visibleHeight)
  );

  // DOM rectangles are viewport pixels; fixed offsets inherit the app's CSS zoom.
  const scale = Number.isFinite(cssScale) && cssScale > 0 ? cssScale : 1;
  return { left: left / scale, maxHeight: maxHeight / scale,
    maxWidth: Math.max(0, viewport.width - margin * 2) / scale, placement, top: top / scale };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
