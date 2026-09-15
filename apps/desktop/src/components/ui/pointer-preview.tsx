import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { HOVER_SURFACE_CLASS } from './hover-interactions';
import { ViewportOverlay } from './viewport-overlay';

export type PreviewAnchor = { x: number; top: number; bottom: number };
const MARGIN = 12;
const GAP = 8;

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
      surface.style.width = `${nextWidth}px`;
      surface.style.maxHeight = `${Math.max(0, Math.min(maxHeightRef.current ?? Infinity, bounds.height - MARGIN * 2))}px`;
      const physical = anchorRef.current;
      const logical = { x: (physical.x - rect.left) / scale, top: (physical.top - rect.top) / scale, bottom: (physical.bottom - rect.top) / scale };
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
