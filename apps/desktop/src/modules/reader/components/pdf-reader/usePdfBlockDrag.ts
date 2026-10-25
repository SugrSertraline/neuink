import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { pdfBlockDrag, type PdfBlockDragItem } from '@/shared/lib/pdfBlockDrag';
import { usePointerItemDrag } from '@/shared/lib/usePointerItemDrag';

export function isPdfBlockDragControl(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    'button, a, input, textarea, select, [contenteditable="true"], [data-paper-reference], [data-hover-surface], [data-reading-selection-toolbar]',
  ));
}

/** The page captures an explicit Ctrl gesture; ordinary PDF selection stays native. */
export function usePdfBlockDrag(context: string, enabled: boolean) {
  const drag = usePointerItemDrag<PdfBlockDragItem>(`${context}:${enabled}`, pdfBlockDrag);
  const ignoreClick = useRef(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);

  useEffect(() => {
    setCtrlHeld(false);
    if (!enabled) return;
    const key = (event: KeyboardEvent) => {
      const held = event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
      if (held && isPdfBlockDragControl(event.target)) return;
      setCtrlHeld(held);
    };
    const clear = () => setCtrlHeld(false);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', clear);
    window.addEventListener('neuink:reader-surface-change', clear);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', clear);
      window.removeEventListener('neuink:reader-surface-change', clear);
    };
  }, [context, enabled]);

  return {
    ...drag,
    ctrlHeld,
    trackModifier(event: ReactPointerEvent<HTMLElement>) {
      // Do not change the gesture's presentation halfway through native selection.
      if (!event.buttons) setCtrlHeld(enabled && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey);
    },
    start(event: ReactPointerEvent<HTMLElement>, item: PdfBlockDragItem | null) {
      if (event.button !== 0 || event.isPrimary === false || drag.dragItem) return false;
      ignoreClick.current = false;
      drag.consumeDragClick();
      if (!enabled || !item || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || isPdfBlockDragControl(event.target)) return false;
      if (!drag.handlers(item).onPointerDown(event)) return false;
      // Cancel the compatibility mousedown before PDF.js or the browser starts selecting.
      event.preventDefault();
      event.stopPropagation();
      ignoreClick.current = true;
      return true;
    },
    consumeClick() {
      const consumed = drag.consumeDragClick() || ignoreClick.current;
      ignoreClick.current = false;
      return consumed;
    },
  };
}
