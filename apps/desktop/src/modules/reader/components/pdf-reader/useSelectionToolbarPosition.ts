import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { calculateFloatingToolbarLayout, type FloatingToolbarLayout } from './selectionToolbarLayout';
import type { PendingPdfTextSelection } from './PdfTextSelectionToolbar';

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Drag = { side?: 'left' | 'right'; size: Size; scale: number; previousSize: Size | null; id: number; start: Point; origin: Point; previousPoint: Point | null; element: HTMLElement; moved: boolean };

/** Positions are stored in viewport pixels and converted once for CSS zoom. */
export function useSelectionToolbarPosition(ref: RefObject<HTMLDivElement>, pending: PendingPdfTextSelection | null, visible: boolean, contentKey: string) {
  const [size, setSize] = useState<Size | null>(null);
  const [pinned, setPinned] = useState(false);
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
    if (cancel) { setPoint(current.previousPoint); setSize(current.previousSize); }
    if (current.element.hasPointerCapture?.(current.id)) current.element.releasePointerCapture(current.id);
  }, []);

  useEffect(() => {
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
  }, [finish]);

  const selectionKey = pending ? JSON.stringify([pending.segment.uid, pending.selection.page_idx, pending.selection.text, pending.selection.rects]) : '';
  const previousSelectionKey = useRef(selectionKey);
  useLayoutEffect(() => {
    if (previousSelectionKey.current === selectionKey) return;
    previousSelectionKey.current = selectionKey;
    finish(true);
    if (!pinned) setPoint(null);
  }, [selectionKey, pinned, finish]);

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
          const height = Math.min(size ? size.height * cssScale : ref.current.scrollHeight * cssScale, Math.max(0, area.height - margin * 2));
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
  }, [pending, visible, point, size, contentKey, ref]);

  const reset = useCallback(() => { finish(true); setPinned(false); setSize(null); setPoint(null); setLayout(null); }, [finish]);
  const toggle = () => {
    finish(true);
    const bounds = ref.current?.getBoundingClientRect();
    setPinned(!pinned);
    setPoint(pinned ? null : bounds ? { x: bounds.left, y: bounds.top } : null);
  };
  const applyGesture = (current: Drag, x: number, y: number) => {
    const dx = x - current.start.x, dy = y - current.start.y;
    if (!current.side) { setPoint({ x: current.origin.x + dx, y: current.origin.y + dy }); return; }
    const viewport = window.visualViewport;
    const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
    const rightEdge = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 8;
    const bottomEdge = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8;
    const right = current.origin.x + current.size.width;
    const availableWidth = Math.max(1, current.side === 'left' ? right - leftEdge : rightEdge - current.origin.x);
    const availableHeight = Math.max(1, bottomEdge - current.origin.y);
    const width = Math.min(availableWidth, Math.max(Math.min(280 * current.scale, availableWidth),
      current.size.width + (current.side === 'left' ? -dx : dx)));
    const height = Math.min(availableHeight, Math.max(Math.min(160 * current.scale, availableHeight), current.size.height + dy));
    setPoint({ x: current.side === 'left' ? right - width : current.origin.x, y: current.origin.y });
    setSize({ width: width / current.scale, height: height / current.scale });
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
      document.body.style.cursor = current.side ? (current.side === 'left' ? 'nesw-resize' : 'nwse-resize') : 'grabbing';
      restoreStyles.current = () => { document.body.style.userSelect = userSelect; document.body.style.cursor = cursor; };
    }
    window.cancelAnimationFrame(dragFrame.current);
    dragFrame.current = window.requestAnimationFrame(() => applyGesture(current, event.clientX, event.clientY));
  };
  const gestureProps = (side?: 'left' | 'right') => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.isPrimary === false || drag.current) return;
      event.preventDefault();
      const bounds = ref.current?.getBoundingClientRect();
      if (!bounds) return;
      drag.current = { side, size: { width: bounds.width, height: bounds.height },
        scale: ref.current!.offsetWidth > 0 ? bounds.width / ref.current!.offsetWidth : 1, previousSize: size, id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: bounds.left, y: bounds.top }, previousPoint: pointRef.current, element: event.currentTarget, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: move,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      if (drag.current?.id !== event.pointerId) return;
      // Commit the final coordinates even if the last animation frame is pending.
      const current = drag.current;
      if (current.moved) applyGesture(current, event.clientX, event.clientY);
      finish(false);
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => { if (drag.current?.id === event.pointerId) finish(true); },
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => { if (drag.current?.id === event.pointerId) finish(true); },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const bounds = ref.current?.getBoundingClientRect();
      if (!bounds) return;
      const step = event.shiftKey ? 20 : 5;
      if (side) {
        applyGesture({ side, size: { width: bounds.width, height: bounds.height },
          scale: ref.current!.offsetWidth > 0 ? bounds.width / ref.current!.offsetWidth : 1,
          origin: { x: bounds.left, y: bounds.top }, start: { x: 0, y: 0 },
          previousPoint: point, previousSize: size, element: event.currentTarget, id: 0, moved: true },
          event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
          event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
        return;
      }
      setPoint({ x: bounds.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y: bounds.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) });
    },
  });
  return { pinned, layout, size, reset, toggle, handleProps: gestureProps(), resizeProps: gestureProps };
}
