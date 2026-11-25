import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type Drag = { pointerId: number; start: Point; offset: Point; scale: Point; moved: boolean };
type Anchor = { content: Point; viewport: Point };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

function displayScale(viewport: HTMLElement): Point {
  const rect = viewport.getBoundingClientRect();
  return { x: rect.width && viewport.offsetWidth ? rect.width / viewport.offsetWidth : 1,
    y: rect.height && viewport.offsetHeight ? rect.height / viewport.offsetHeight : 1 };
}

/** The tree keeps native scrolling; its camera is independent of tag editing and app zoom. */
export function useTagEditorViewport(size: Size) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const dragRef = useRef<Drag | null>(null);
  const renderedZoom = useRef(1);
  const requestedZoom = useRef(1);
  const pendingAnchor = useRef<Anchor | null>(null);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);

  const applyOffset = useCallback((offset: Point) => {
    offsetRef.current = offset;
    if (stageRef.current) stageRef.current.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`;
  }, []);
  const finish = useCallback((pointerId: number, cancel = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    if (cancel) applyOffset(drag.offset);
    const viewport = viewportRef.current;
    if (viewport?.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId);
    setDragging(false);
  }, [applyOffset]);
  const cancelPan = useCallback(() => {
    if (dragRef.current) finish(dragRef.current.pointerId, true);
  }, [finish]);
  const resetView = () => {
    cancelPan();
    pendingAnchor.current = null;
    applyOffset({ x: 0, y: 0 });
    if (viewportRef.current) { viewportRef.current.scrollLeft = 0; viewportRef.current.scrollTop = 0; }
  };
  const zoomTo = useCallback((value: number, clientPoint?: Point) => {
    const viewport = viewportRef.current, stage = stageRef.current;
    const next = clampZoom(value);
    if (!viewport || !stage || next === requestedZoom.current) return;
    if (dragRef.current) finish(dragRef.current.pointerId);
    const rect = viewport.getBoundingClientRect(), stageRect = stage.getBoundingClientRect();
    const scale = displayScale(viewport);
    const anchor = clientPoint ?? { x: rect.left + viewport.clientWidth * scale.x / 2, y: rect.top + viewport.clientHeight * scale.y / 2 };
    pendingAnchor.current = {
      content: { x: (anchor.x - stageRect.left) / scale.x / renderedZoom.current, y: (anchor.y - stageRect.top) / scale.y / renderedZoom.current },
      viewport: { x: (anchor.x - rect.left) / scale.x, y: (anchor.y - rect.top) / scale.y }
    };
    requestedZoom.current = next;
    setZoom(next);
  }, [finish]);

  useLayoutEffect(() => {
    renderedZoom.current = zoom;
    applyOffset(offsetRef.current);
    const anchor = pendingAnchor.current, viewport = viewportRef.current, stage = stageRef.current;
    pendingAnchor.current = null;
    if (!anchor || !viewport || !stage) return;
    const rect = viewport.getBoundingClientRect(), stageRect = stage.getBoundingClientRect();
    const scale = displayScale(viewport);
    // Account for centering margins and native scroll clamping after the scaled bounds change.
    applyOffset({ x: offsetRef.current.x + anchor.viewport.x - (stageRect.left - rect.left) / scale.x - anchor.content.x * zoom,
      y: offsetRef.current.y + anchor.viewport.y - (stageRect.top - rect.top) / scale.y - anchor.content.y * zoom });
  }, [zoom, size.width, size.height, applyOffset]);

  const fitView = () => {
    const viewport = viewportRef.current;
    if (!viewport || !stageRef.current) return;
    resetView();
    const next = clampZoom(Math.min(1, Math.max(1, viewport.clientWidth - 32) / size.width, Math.max(1, viewport.clientHeight - 32) / size.height));
    requestedZoom.current = next;
    setZoom(next);
  };
  const zoomIn = () => zoomTo(Math.round((requestedZoom.current + 0.1) * 100) / 100);
  const zoomOut = () => zoomTo(Math.round((requestedZoom.current - 0.1) * 100) / 100);
  const resetZoom = () => zoomTo(1);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.defaultPrevented || !stageRef.current) return;
      event.preventDefault(); event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      if (delta) zoomTo(requestedZoom.current * Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.002), { x: event.clientX, y: event.clientY });
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('blur', cancelPan);
    window.addEventListener('resize', cancelPan);
    return () => {
      viewport.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', cancelPan);
      window.removeEventListener('resize', cancelPan);
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag && viewport.hasPointerCapture?.(drag.pointerId)) viewport.releasePointerCapture(drag.pointerId);
    };
  }, [zoomTo, cancelPan]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current || event.pointerType === 'touch' || event.isPrimary === false || (event.button !== 0 && event.button !== 1)) return;
    if (event.button === 0 && (event.target as Element).closest('[data-tag-editor-node], button, input, [role="menu"]')) return;
    dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, offset: { ...offsetRef.current }, scale: displayScale(event.currentTarget), moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.start.x, dy = event.clientY - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    setDragging(true);
    applyOffset({ x: drag.offset.x + dx / drag.scale.x, y: drag.offset.y + dy / drag.scale.y });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && dragRef.current) {
      event.preventDefault(); event.stopPropagation(); cancelPan(); return;
    }
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '+' || event.key === '=') zoomIn();
    else if (event.key === '-' || event.key === '_') zoomOut();
    else if (event.key === '0') resetZoom();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  return { viewportRef, stageRef, dragging, zoom, canZoomIn: zoom < MAX_ZOOM, canZoomOut: zoom > MIN_ZOOM,
    zoomIn, zoomOut, resetZoom, fitView, resetView, cancelPan, onPointerDown, onPointerMove, onKeyDown,
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, true),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, true) };
}
