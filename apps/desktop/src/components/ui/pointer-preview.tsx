import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { HOVER_SURFACE_CLASS } from './hover-interactions';
import { ViewportOverlay } from './viewport-overlay';

export type PreviewAnchor = { x: number; right?: number; top: number; bottom: number };
const MARGIN = 12;
const GAP = 8;

/** A PDF block is selectable content, so an interactive preview must stay outside it. */
export function placeBlockPreview(anchor: PreviewAnchor & { right: number }, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const width = Math.max(0, viewport.width - MARGIN * 2);
  const height = Math.max(0, viewport.height - MARGIN * 2);
  const preferredWidth = Math.min(size.width, width);
  const minimumWidth = Math.min(240, preferredWidth);
  const minimumHeight = Math.min(80, size.height);
  const spaces = [
    { side: 'below', left: MARGIN, top: Math.max(MARGIN, anchor.bottom + GAP), width, height: viewport.height - MARGIN - Math.max(MARGIN, anchor.bottom + GAP) },
    { side: 'above', left: MARGIN, top: MARGIN, width, height: Math.min(viewport.height - MARGIN, anchor.top - GAP) - MARGIN },
    { side: 'right', left: Math.max(MARGIN, anchor.right + GAP), top: MARGIN, width: viewport.width - MARGIN - Math.max(MARGIN, anchor.right + GAP), height },
    { side: 'left', left: MARGIN, top: MARGIN, width: Math.min(viewport.width - MARGIN, anchor.x - GAP) - MARGIN, height },
  ].map(space => ({ ...space, width: Math.min(preferredWidth, space.width) }))
    .filter(space => space.width >= minimumWidth && space.height >= minimumHeight && space.width > 0 && space.height > 0)
    .sort((a, b) => b.width * Math.min(size.height, b.height) - a.width * Math.min(size.height, a.height));
  const space = spaces[0];
  if (!space) return null;
  const shownHeight = Math.min(size.height, space.height);
  return {
    side: space.side, width: space.width, maxHeight: space.height,
    left: space.side === 'left' ? Math.min(viewport.width - MARGIN, anchor.x - GAP) - space.width
      : space.side === 'right' ? space.left : clamp(anchor.x, MARGIN, viewport.width - MARGIN - space.width),
    top: space.side === 'above' ? space.top + space.height - shownHeight
      : space.side === 'below' ? space.top : clamp(anchor.top, MARGIN, viewport.height - MARGIN - shownHeight),
  };
}

export function placePointerPreview(anchor: PreviewAnchor, size: { width: number; height: number }, viewport: { width: number; height: number }) {
  const rightSpace = viewport.width - MARGIN - anchor.x - GAP;
  const leftSpace = anchor.x - GAP - MARGIN;
  const belowSpace = viewport.height - MARGIN - anchor.bottom - GAP;
  const aboveSpace = anchor.top - GAP - MARGIN;
  return {
    left: clamp(rightSpace >= size.width || rightSpace >= leftSpace ? anchor.x + GAP : anchor.x - GAP - size.width,
      MARGIN, viewport.width - size.width - MARGIN),
    top: clamp(belowSpace >= size.height || belowSpace >= aboveSpace ? anchor.bottom + GAP : anchor.top - GAP - size.height,
      MARGIN, viewport.height - size.height - MARGIN),
  };
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(value, max)); }

/** The fixed viewport owns positioning; the surface owns scrolling only when interactive.
 * Coordinates arrive in client pixels. The containing block converts CSS UI zoom once.
 * Pointer movement updates only this DOM node, never a whole PDF/reflow document.
 */
export function PointerPreview({
  anchor, width, maxHeight, interactive = false, onMoveReady, className, children, ...props
}: Omit<ComponentProps<'div'>, 'style'> & {
  anchor: PreviewAnchor;
  width: number;
  maxHeight?: number;
  interactive?: boolean;
  onMoveReady?: (move: (anchor: PreviewAnchor) => void) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(anchor);
  const widthRef = useRef(width);
  widthRef.current = width;
  const maxHeightRef = useRef(maxHeight);
  maxHeightRef.current = maxHeight;
  const repositionRef = useRef(() => {});

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const surface = surfaceRef.current;
    if (!viewport || !surface) return;
    let frame: number | null = null;
    const place = () => {
      const rect = viewport.getBoundingClientRect();
      const scale = viewport.clientWidth && rect.width ? rect.width / viewport.clientWidth : 1;
      const bounds = { width: viewport.clientWidth || window.innerWidth, height: viewport.clientHeight || window.innerHeight };
      const nextWidth = Math.min(widthRef.current, Math.max(0, bounds.width - MARGIN * 2));
      surface.hidden = false;
      surface.style.width = `${nextWidth}px`;
      surface.style.maxHeight = `${Math.max(0, Math.min(maxHeightRef.current ?? Infinity, bounds.height - MARGIN * 2))}px`;
      const physical = anchorRef.current;
      const logical = { x: (physical.x - rect.left) / scale, top: (physical.top - rect.top) / scale, bottom: (physical.bottom - rect.top) / scale };
      if (physical.right !== undefined) {
        const anchor = { ...logical, right: (physical.right - rect.left) / scale };
        const space = placeBlockPreview(anchor, { width: nextWidth, height: surface.getBoundingClientRect().height / scale }, bounds);
        // A block filling the viewport has no safe hover surface. Its explicit
        // context menu remains available; never cover its text with a hit target.
        if (!space) { surface.hidden = true; return; }
        surface.style.width = `${space.width}px`;
        surface.style.maxHeight = `${Math.min(space.maxHeight, maxHeightRef.current ?? Infinity)}px`;
        const height = surface.getBoundingClientRect().height / scale;
        surface.style.left = `${space.left}px`;
        surface.style.top = `${space.side === 'above' ? Math.min(bounds.height - MARGIN, anchor.top - GAP) - height
          : space.side === 'below' ? space.top : clamp(anchor.top, MARGIN, bounds.height - MARGIN - height)}px`;
        return;
      }
      const position = placePointerPreview(logical, { width: nextWidth, height: surface.getBoundingClientRect().height / scale }, bounds);
      surface.style.left = `${position.left}px`;
      surface.style.top = `${position.top}px`;
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; place(); });
    };
    repositionRef.current = place;
    onMoveReady?.((next) => { anchorRef.current = next; schedule(); });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(viewport);
    observer?.observe(surface);
    place();
    return () => {
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      onMoveReady?.(() => {});
      repositionRef.current = () => {};
    };
  }, [onMoveReady]);

  useLayoutEffect(() => { anchorRef.current = anchor; repositionRef.current(); }, [anchor, width, maxHeight]);
  if (typeof document === 'undefined') return null;
  return createPortal(<ViewportOverlay enabled layer="reader-preview" ref={viewportRef} interactive={interactive}>
    <div {...props} ref={surfaceRef} data-slot="pointer-preview" data-hover-surface="true"
      className={cn(HOVER_SURFACE_CLASS, 'absolute min-w-0 text-sm leading-5',
        interactive ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden', className)}>{children}</div>
  </ViewportOverlay>, document.body);
}
