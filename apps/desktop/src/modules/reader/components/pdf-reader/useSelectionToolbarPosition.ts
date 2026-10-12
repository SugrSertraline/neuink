import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { calculateFloatingToolbarLayout, type FloatingToolbarLayout } from './selectionToolbarLayout';
import type { PendingPdfTextSelection } from './PdfTextSelectionToolbar';

type Point = { x: number; y: number };
type Drag = { id: number; start: Point; origin: Point; element: HTMLElement; moved: boolean };

/** Positions are stored in viewport pixels and converted once for CSS zoom. */
export function useSelectionToolbarPosition(ref: RefObject<HTMLDivElement>, pending: PendingPdfTextSelection | null, visible: boolean, contentKey: string) {
  const [point, setPoint] = useState<Point | null>(null);
  const [layout, setLayout] = useState<FloatingToolbarLayout | null>(null);
  const drag = useRef<Drag | null>(null);
  const dragFrame = useRef(0);
  const restoreStyles = useRef<(() => void) | null>(null);
  const pointRef = useRef(point);
  pointRef.current = point;

  const finish = useCallback((cancel: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    window.cancelAnimationFrame(dragFrame.current);
    restoreStyles.current?.();
    restoreStyles.current = null;
    if (cancel) setPoint(current.origin);
    if (current.element.hasPointerCapture?.(current.id)) current.element.releasePointerCapture(current.id);
  }, []);

  useEffect(() => {
    if (!pointRef.current) return;
    const cancel = () => finish(true);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(true);
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape, true);
      const current = drag.current;
      drag.current = null;
      window.cancelAnimationFrame(dragFrame.current);
      restoreStyles.current?.();
      if (current?.element.hasPointerCapture?.(current.id)) current.element.releasePointerCapture(current.id);
    };
  }, [finish, point !== null]);

  useEffect(() => { if (!visible) finish(true); }, [visible, finish]);

  useLayoutEffect(() => {
    if (!pending || !visible) return;
    if (!pointRef.current) setLayout(null);
    let frame = 0;
    const element = ref.current;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!ref.current) return;
        const bounds = ref.current.getBoundingClientRect();
        const cssScale = ref.current.offsetWidth > 0 ? bounds.width / ref.current.offsetWidth : 1;
        const viewport = window.visualViewport;
        const area = { height: viewport?.height ?? window.innerHeight, width: viewport?.width ?? window.innerWidth,
          left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0 };
        if (pointRef.current) {
          const margin = 8;
          const width = Math.min(bounds.width, Math.max(0, area.width - margin * 2));
          const height = Math.min(ref.current.scrollHeight * cssScale, Math.max(0, area.height - margin * 2));
          const left = Math.max(area.left + margin, Math.min(pointRef.current.x, area.left + area.width - margin - width));
          const top = Math.max(area.top + margin, Math.min(pointRef.current.y, area.top + area.height - margin - height));
          setLayout({ left: left / cssScale, top: top / cssScale, maxHeight: (area.height - margin * 2) / cssScale,
            maxWidth: (area.width - margin * 2) / cssScale, placement: 'below' });
        } else {
          setLayout(calculateFloatingToolbarLayout({
            anchor: pending.anchorRect ?? { bottom: pending.position.y, top: pending.position.y, left: pending.position.x, right: pending.position.x },
            contentHeight: ref.current.scrollHeight * cssScale, contentWidth: bounds.width, cssScale, viewport: area,
          }));
        }
      });
    };
    const observer = element && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (element) observer?.observe(element);
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [pending, visible, point, contentKey, ref]);

  const reset = useCallback(() => { finish(true); setPoint(null); setLayout(null); }, [finish]);
  const toggle = () => {
    finish(true);
    const bounds = ref.current?.getBoundingClientRect();
    setPoint(current => current ? null : bounds ? { x: bounds.left, y: bounds.top } : null);
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 4) return;
    current.moved = true;
    if (!restoreStyles.current) {
      const { userSelect, cursor } = document.body.style;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
      restoreStyles.current = () => { document.body.style.userSelect = userSelect; document.body.style.cursor = cursor; };
    }
    window.cancelAnimationFrame(dragFrame.current);
    dragFrame.current = window.requestAnimationFrame(() => setPoint({ x: current.origin.x + dx, y: current.origin.y + dy }));
  };
  return { pinned: point !== null, layout, reset, toggle, handleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (!point || event.button !== 0 || event.isPrimary === false || drag.current) return;
      event.preventDefault();
      const bounds = ref.current?.getBoundingClientRect();
      if (!bounds) return;
      drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: bounds.left, y: bounds.top }, element: event.currentTarget, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: move,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      if (drag.current?.id !== event.pointerId) return;
      // Commit the final coordinates even if the last animation frame is pending.
      const current = drag.current;
      if (current.moved) setPoint({ x: current.origin.x + event.clientX - current.start.x, y: current.origin.y + event.clientY - current.start.y });
      finish(false);
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => { if (drag.current?.id === event.pointerId) finish(true); },
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => { if (drag.current?.id === event.pointerId) finish(true); },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (!point || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const bounds = ref.current?.getBoundingClientRect();
      if (!bounds) return;
      const step = event.shiftKey ? 20 : 5;
      setPoint({ x: bounds.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y: bounds.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) });
    },
  } };
}
