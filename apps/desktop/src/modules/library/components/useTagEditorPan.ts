import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

type Point = { x: number; y: number };
type Drag = { pointerId: number; start: Point; offset: Point };

export function useTagEditorPan() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const dragRef = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);

  const applyOffset = (offset: Point) => {
    offsetRef.current = offset;
    if (stageRef.current) stageRef.current.style.transform = `translate3d(${offset.x}px, ${offset.y}px, 0)`;
  };
  const finish = (pointerId: number, cancel = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    if (cancel) applyOffset(drag.offset);
    const viewport = viewportRef.current;
    if (viewport?.hasPointerCapture?.(pointerId)) viewport.releasePointerCapture(pointerId);
    setDragging(false);
  };
  const resetView = () => {
    if (dragRef.current) finish(dragRef.current.pointerId, true);
    applyOffset({ x: 0, y: 0 });
    if (viewportRef.current) { viewportRef.current.scrollLeft = 0; viewportRef.current.scrollTop = 0; }
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current || event.pointerType === 'touch' || event.isPrimary === false || (event.button !== 0 && event.button !== 1)) return;
    if (event.button === 0 && (event.target as Element).closest('[data-tag-editor-node], button, input, [role="menu"]')) return;
    dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, offset: { ...offsetRef.current } };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    event.preventDefault();
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    applyOffset({ x: drag.offset.x + event.clientX - drag.start.x, y: drag.offset.y + event.clientY - drag.start.y });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !dragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    finish(dragRef.current.pointerId, true);
  };

  return { viewportRef, stageRef, dragging, resetView, onPointerDown, onPointerMove, onKeyDown,
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, true),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId) };
}
