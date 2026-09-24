import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type View = { zoom: number | null; offset: Point };
type Drag = { id: number; start: Point; origin: Point; element: HTMLDivElement; moved: boolean };
const centered = (): View => ({ zoom: null, offset: { x: 0, y: 0 } });

function boundedOffset(offset: Point, scale: number, natural: Size, available: Size): Point {
  const x = Math.max(0, (natural.width * scale - available.width) / 2);
  const y = Math.max(0, (natural.height * scale - available.height) / 2);
  return { x: Math.max(-x, Math.min(x, offset.x)), y: Math.max(-y, Math.min(y, offset.y)) };
}

/** Coordinates stay in canvas CSS pixels, including when the app uses CSS zoom. */
function localPoint(element: HTMLElement, clientX: number, clientY: number): Point {
  const rect = element.getBoundingClientRect();
  return { x: (clientX - rect.left) * element.clientWidth / (rect.width || 1),
    y: (clientY - rect.top) * element.clientHeight / (rect.height || 1) };
}

export function useImageViewport(natural: Size) {
  const [viewport, setViewportElement] = useState<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const setViewport = useCallback((element: HTMLDivElement | null) => {
    viewportRef.current = element;
    setViewportElement(element);
  }, []);
  const [available, setAvailable] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View>(centered);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const ready = natural.width > 0 && natural.height > 0 && available.width > 0 && available.height > 0;
  const fitted = ready ? Math.min(1, available.width / natural.width, available.height / natural.height) : 1;
  const minScale = Math.min(0.1, fitted);
  const scale = view.zoom ?? fitted;
  const offset = boundedOffset(view.offset, scale, natural, available);
  const canPan = ready && (natural.width * scale > available.width + 1 || natural.height * scale > available.height + 1);

  const endDrag = useCallback((cancel: boolean, update = true) => {
    const active = drag.current;
    if (!active) return false;
    drag.current = null;
    if (update) {
      setDragging(false);
      if (cancel) setView(value => ({ ...value, offset: active.origin }));
    }
    if (active.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id);
    return true;
  }, []);

  useEffect(() => {
    if (!viewport) return;
    const measure = () => {
      endDrag(true);
      setAvailable({ width: viewport.clientWidth, height: viewport.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport, endDrag]);

  useEffect(() => {
    const cancel = () => { endDrag(true); };
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('blur', cancel); endDrag(false, false); };
  }, [endDrag]);

  const fit = () => { endDrag(false); setView(centered()); };
  const original = () => { endDrag(false); setView({ zoom: 1, offset: { x: 0, y: 0 } }); };
  const zoomBy = useCallback((factor: number, anchor?: Point) => {
    if (!ready) return;
    endDrag(false);
    setView(previous => {
      const before = previous.zoom ?? fitted;
      const next = Math.max(minScale, Math.min(4, before * factor));
      const position = boundedOffset(previous.offset, before, natural, available);
      const point = anchor ?? { x: available.width / 2, y: available.height / 2 };
      const x = point.x - available.width / 2;
      const y = point.y - available.height / 2;
      // Keep the pixel beneath the pointer stationary unless an image edge is reached.
      return { zoom: next, offset: boundedOffset({ x: x - (x - position.x) * next / before,
        y: y - (y - position.y) * next / before }, next, natural, available) };
    });
  }, [ready, fitted, minScale, natural, available, endDrag]);

  useEffect(() => {
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? available.height : 1);
      if (delta) zoomBy(Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002), localPoint(viewport, event.clientX, event.clientY));
    };
    // React's delegated wheel listener can be passive; the canvas must not scroll the reader.
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [viewport, available.height, zoomBy]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false || !canPan || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, start: localPoint(event.currentTarget, event.clientX, event.clientY),
      origin: offset, element: event.currentTarget, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.id) return;
    const point = localPoint(active.element, event.clientX, event.clientY);
    const dx = point.x - active.start.x;
    const dy = point.y - active.start.y;
    if (!active.moved && Math.hypot(dx, dy) < 4) return;
    active.moved = true;
    setDragging(true);
    setView(previous => ({ ...previous, offset: boundedOffset({ x: active.origin.x + dx, y: active.origin.y + dy }, scale, natural, available) }));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '+' || event.key === '=') zoomBy(1.25);
    else if (event.key === '-' || event.key === '_') zoomBy(1 / 1.25);
    else if (event.key === '0' || event.key === 'Home') fit();
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      endDrag(false);
      const step = event.shiftKey ? 120 : 40;
      setView(previous => ({ ...previous, offset: boundedOffset({
        x: offset.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0),
        y: offset.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0)
      }, scale, natural, available) }));
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return { setViewport, focus: () => viewportRef.current?.focus(), scale, minScale, offset, isFitted: view.zoom === null, canPan, dragging, fit, original, zoomBy, endDrag,
    handlers: { onPointerDown, onPointerMove, onKeyDown,
      onPointerUp: (event: PointerEvent) => { if (drag.current?.id === event.pointerId) endDrag(false); },
      onPointerCancel: (event: PointerEvent) => { if (drag.current?.id === event.pointerId) endDrag(true); },
      onLostPointerCapture: (event: PointerEvent) => { if (drag.current?.id === event.pointerId) endDrag(true); }
    } };
}
