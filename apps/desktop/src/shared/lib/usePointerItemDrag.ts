import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type ItemDrag<T> = {
  item: T;
  pointerId: number;
  element: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
  previousStyles?: { cursor: string; userSelect: string };
};

type DragSession<T> = {
  begin: (item: T, x: number, y: number) => void;
  update: (x: number, y: number) => void;
  finish: (x: number, y: number) => unknown;
  cancel: () => void;
};

/** Shared pointer ownership, cancellation and bounded auto-scroll for document drags. */
export function usePointerItemDrag<T>(context: string, session: DragSession<T>, {
  autoScroll = true, cursor = 'grabbing'
}: { autoScroll?: boolean; cursor?: string | ((item: T) => string) } = {}) {
  const dragRef = useRef<ItemDrag<T> | null>(null);
  const frameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [dragItem, setDragItem] = useState<T | null>(null);
  const [preview, setPreview] = useState<{ item: T; x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.dragging) session.cancel();
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (drag.previousStyles) {
      document.body.style.cursor = drag.previousStyles.cursor;
      document.body.style.userSelect = drag.previousStyles.userSelect;
    }
    if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    setDragItem(null);
    setPreview(null);
  }, [session]);

  const cancel = useCallback(() => {
    if (dragRef.current) suppressClickRef.current = true;
    clear();
  }, [clear]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('neuink:reader-surface-change', cancel);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('neuink:reader-surface-change', cancel);
      cancel();
    };
  }, [cancel, context]);

  const scrollFrame = () => {
    const drag = dragRef.current;
    if (!drag?.dragging) return;
    if (scrollAtPointer(drag.x, drag.y)) session.update(drag.x, drag.y);
    frameRef.current = requestAnimationFrame(scrollFrame);
  };

  const pointerHandlers = {
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (!drag.dragging) {
        if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
        drag.dragging = true;
        suppressClickRef.current = true;
        drag.previousStyles = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
        document.body.style.cursor = typeof cursor === 'function' ? cursor(drag.item) : cursor;
        document.body.style.userSelect = 'none';
        session.begin(drag.item, drag.x, drag.y);
        if (autoScroll) frameRef.current = requestAnimationFrame(scrollFrame);
      } else session.update(drag.x, drag.y);
      setPreview({ item: drag.item, x: drag.x, y: drag.y });
      event.preventDefault();
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      try { if (drag.dragging) session.finish(event.clientX, event.clientY); } finally { clear(); }
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => { if (dragRef.current?.pointerId === event.pointerId) cancel(); },
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => { if (dragRef.current?.pointerId === event.pointerId) cancel(); }
  };

  const handlers = (item: T) => ({
    ...pointerHandlers,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      const control = event.target instanceof Element ? event.target.closest('button, a, input, textarea, select, [role="button"]') : null;
      if (event.button !== 0 || event.isPrimary === false || dragRef.current ||
        (control && control !== event.currentTarget)) return false;
      suppressClickRef.current = false;
      dragRef.current = {
        item, pointerId: event.pointerId, element: event.currentTarget, dragging: false,
        startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY
      };
      setDragItem(item);
      event.currentTarget.setPointerCapture(event.pointerId);
      return true;
    },
  });

  return {
    handlers, pointerHandlers, dragItem, preview, cancel,
    ownsPointer: (pointerId: number) => Boolean(dragRef.current && dragRef.current.pointerId === pointerId),
    consumeDragClick: () => {
      const suppressed = suppressClickRef.current;
      suppressClickRef.current = false;
      return suppressed;
    }
  };
}

function scrollAtPointer(x: number, y: number) {
  let element = document.elementFromPoint?.(x, y);
  while (element instanceof HTMLElement) {
    if (element.scrollHeight > element.clientHeight && /auto|scroll/.test(getComputedStyle(element).overflowY)) {
      const bounds = element.getBoundingClientRect();
      const edge = Math.min(28, bounds.height / 4);
      const delta = y < bounds.top + edge ? -8 : y > bounds.bottom - edge ? 8 : 0;
      const previous = element.scrollTop;
      element.scrollTop += delta;
      return previous !== element.scrollTop;
    }
    element = element.parentElement;
  }
  return false;
}
