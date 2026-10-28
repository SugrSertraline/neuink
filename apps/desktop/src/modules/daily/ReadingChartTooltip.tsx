import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { placePointerPreview } from '@/components/ui/pointer-preview';

export type ChartHintAnchor = { x: number; y: number };
export type ChartTooltipHandle = { move: (point: ChartHintAnchor) => void };

/** The chart grid bounds the bubble. Pointer movement only repositions this surface, not the plots. */
export const ReadingChartTooltip = forwardRef<ChartTooltipHandle, {
  id: string; containerRef: RefObject<HTMLDivElement>; anchor: ChartHintAnchor; children: ReactNode;
}>(function ReadingChartTooltip({ id, containerRef, anchor, children }, ref) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(anchor);
  const moveRef = useRef<(point: ChartHintAnchor) => void>(() => {});
  const placeRef = useRef(() => {});
  useImperativeHandle(ref, () => ({ move: point => moveRef.current(point) }), []);
  useLayoutEffect(() => {
    const container = containerRef.current, surface = surfaceRef.current;
    if (!container || !surface) return;
    let frame: number | null = null;
    const place = () => {
      const rect = container.getBoundingClientRect();
      const scale = container.offsetWidth && rect.width ? rect.width / container.offsetWidth : 1;
      const bounds = { width: container.clientWidth || rect.width, height: container.clientHeight || rect.height };
      const width = Math.min(216, Math.max(0, bounds.width - 24));
      surface.style.width = `${width}px`;
      const point = { x: (anchorRef.current.x - rect.left) / scale, top: (anchorRef.current.y - rect.top) / scale,
        bottom: (anchorRef.current.y - rect.top) / scale };
      const position = placePointerPreview(point, { width, height: surface.offsetHeight }, bounds);
      surface.style.left = `${position.left}px`;
      surface.style.top = `${position.top}px`;
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; place(); });
    };
    placeRef.current = place;
    moveRef.current = point => { anchorRef.current = point; schedule(); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(container); observer?.observe(surface);
    place();
    return () => {
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      moveRef.current = () => {}; placeRef.current = () => {};
    };
  }, [containerRef]);
  useLayoutEffect(() => { anchorRef.current = anchor; placeRef.current(); }, [anchor]);
  return <div ref={surfaceRef} id={id} role="tooltip"
    className="reading-chart-tooltip pointer-events-none absolute z-30 rounded-lg border border-border/70 bg-popover px-3 py-2.5 text-xs font-normal leading-5 text-popover-foreground shadow-lg">
    {children}
  </div>;
});
