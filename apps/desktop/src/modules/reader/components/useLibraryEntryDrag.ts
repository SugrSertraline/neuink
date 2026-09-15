import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { beginEntryTagDrag, cancelEntryTagDrag, finishEntryTagDrag, updateEntryTagDrag } from '@/shared/lib/entryDragData';
import type { LibraryEntry } from '../../library/components/LibrarySidebar';

type EntryDrag = {
  entryId: string;
  pointerId: number;
  element: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
  previousStyles?: { cursor: string; userSelect: string };
};

/** One pointer contract for both paper layouts, with cleanup owned by the library session. */
export function useLibraryEntryDrag(context: string) {
  const dragRef = useRef<EntryDrag | null>(null);
  const frameRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [entryDragPreview, setEntryDragPreview] = useState<{ title: string; x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.dragging) cancelEntryTagDrag();
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (drag.previousStyles) {
      document.body.style.cursor = drag.previousStyles.cursor;
      document.body.style.userSelect = drag.previousStyles.userSelect;
    }
    if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    setDraggingEntryId(null);
    setEntryDragPreview(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      clear();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [clear, context]);

  const scrollFrame = () => {
    const drag = dragRef.current;
    if (!drag?.dragging) return;
    if (scrollAtPointer(drag.x, drag.y)) updateEntryTagDrag(drag.x, drag.y);
    frameRef.current = requestAnimationFrame(scrollFrame);
  };

  const entryDragHandlers = (entry: Pick<LibraryEntry, 'id' | 'title'>) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.isPrimary === false || dragRef.current ||
        (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, [role="button"]'))) return;
      suppressClickRef.current = false;
      dragRef.current = {
        entryId: entry.id, pointerId: event.pointerId, element: event.currentTarget, dragging: false,
        startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
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
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        beginEntryTagDrag(drag.entryId, drag.x, drag.y);
        setDraggingEntryId(drag.entryId);
        frameRef.current = requestAnimationFrame(scrollFrame);
      } else updateEntryTagDrag(drag.x, drag.y);
      setEntryDragPreview({ title: entry.title, x: drag.x, y: drag.y });
      event.preventDefault();
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.dragging) finishEntryTagDrag(event.clientX, event.clientY);
      clear();
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => { if (dragRef.current?.pointerId === event.pointerId) clear(); },
    onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => { if (dragRef.current?.pointerId === event.pointerId) clear(); }
  });

  return {
    entryDragHandlers, draggingEntryId, entryDragPreview,
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
