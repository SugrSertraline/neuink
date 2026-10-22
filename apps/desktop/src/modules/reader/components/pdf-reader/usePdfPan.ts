import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { dismissHoverInteractions } from '@/components/ui/hover-interactions';
import { isPdfBlockDragControl } from './usePdfBlockDrag';

type Pan = {
  pointerId: number;
  element: HTMLDivElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
  moved: boolean;
  cursor: string;
  userSelect: string;
};

function isControl(target: EventTarget | null) {
  return isPdfBlockDragControl(target) || (target instanceof Element && Boolean(target.closest(
    '[contenteditable]:not([contenteditable="false"]), [role="button"], [role="switch"], [role="textbox"], [role="slider"], [role="dialog"], [role="menu"]',
  )));
}

/** Space owns a temporary scroll gesture; ordinary selection and Ctrl dragging stay native. */
export function usePdfPan({ scrollRef, context, enabled }: {
  scrollRef: RefObject<HTMLDivElement>;
  context: string;
  enabled: boolean;
}) {
  const [active, setActive] = useState(false);
  const held = useRef(false);
  const hovered = useRef(false);
  const pointerFocusedButton = useRef<Element | null>(null);
  const pressed = useRef(false);
  const pan = useRef<Pan | null>(null);
  const frame = useRef<number | null>(null);
  const ignoreClick = useRef(false);

  const applyScroll = () => {
    frame.current = null;
    const drag = pan.current;
    if (!drag?.moved) return;
    const { element } = drag;
    element.scrollLeft = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, drag.left - (drag.x - drag.startX) / drag.scaleX));
    element.scrollTop = Math.max(0, Math.min(element.scrollHeight - element.clientHeight, drag.top - (drag.y - drag.startY) / drag.scaleY));
  };

  const finish = (commit: boolean) => {
    const drag = pan.current;
    if (!drag) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (commit) applyScroll();
    else if (drag.moved) {
      drag.element.scrollLeft = drag.left;
      drag.element.scrollTop = drag.top;
    }
    pan.current = null;
    document.body.style.cursor = drag.cursor;
    document.body.style.userSelect = drag.userSelect;
    if (held.current) drag.element.dataset.pdfPan = 'ready';
    else delete drag.element.dataset.pdfPan;
    if (drag.element.hasPointerCapture?.(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  };

  const release = (commit = false) => {
    held.current = false;
    finish(commit);
    if (scrollRef.current) delete scrollRef.current.dataset.pdfPan;
    setActive(false);
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!enabled || !element) return;
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && held.current) {
        event.preventDefault();
        event.stopPropagation();
        release();
        return;
      }
      if (event.code !== 'Space' && event.key !== ' ') {
        pointerFocusedButton.current = null;
        return;
      }
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      // A mouse click can leave focus on a sidebar/toolbar button. Once the
      // pointer returns to PDF content, Space belongs to panning, not that button.
      const takePointerFocus = hovered.current && event.target === pointerFocusedButton.current &&
        event.target === document.activeElement;
      if (isControl(event.target) && !takePointerFocus) return;
      if (!hovered.current && !element.contains(document.activeElement) &&
        !(event.target instanceof Node && element.contains(event.target))) return;
      if (pressed.current && !held.current) return;
      if (event.repeat && !held.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (held.current) return;
      if (takePointerFocus) element.focus({ preventScroll: true });
      held.current = true;
      element.dataset.pdfPan = 'ready';
      dismissHoverInteractions();
      setActive(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if ((event.code === 'Space' || event.key === ' ') && held.current) {
        event.preventDefault();
        event.stopPropagation();
        release(true);
      }
    };
    const pointerDown = (event: PointerEvent) => {
      pressed.current = true;
      const target = event.target instanceof Element ? event.target : null;
      pointerFocusedButton.current = event.button === 0 && !target?.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="combobox"], [role="listbox"], [role="dialog"], [role="alertdialog"], [role="menu"], [data-hover-surface], [data-reading-selection-toolbar]',
      ) ? target?.closest('button, [role="button"], [role="switch"]') ?? null : null;
    };
    const pointerMove = (event: PointerEvent) => {
      hovered.current = event.target instanceof Node && element.contains(event.target) && !isControl(event.target);
      const drag = pan.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!(event.buttons & 1)) { release(); pressed.current = false; return; }
      event.preventDefault();
      event.stopPropagation();
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (!drag.moved && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 4) return;
      drag.moved = true;
      drag.element.dataset.pdfPan = 'dragging';
      document.body.style.cursor = 'grabbing';
      if (frame.current === null) frame.current = requestAnimationFrame(applyScroll);
    };
    const pointerUp = (event: PointerEvent) => {
      pressed.current = false;
      if (pan.current?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      pan.current.x = event.clientX;
      pan.current.y = event.clientY;
      finish(true);
    };
    const pointerCancel = (event: PointerEvent) => {
      if (pan.current?.pointerId !== event.pointerId) return;
      pressed.current = false;
      release();
    };
    const cancel = () => { pressed.current = false; hovered.current = false; release(); };
    const visibility = () => { if (document.hidden) cancel(); };
    const focus = (event: FocusEvent) => {
      if (event.target !== pointerFocusedButton.current) pointerFocusedButton.current = null;
      if (isControl(event.target) || !element.contains(event.target as Node)) release();
    };
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', keyUp, true);
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('pointercancel', pointerCancel, true);
    element.addEventListener('lostpointercapture', pointerCancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('neuink:reader-surface-change', cancel);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('focusin', focus);
    return () => {
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerup', pointerUp, true);
      window.removeEventListener('pointercancel', pointerCancel, true);
      element.removeEventListener('lostpointercapture', pointerCancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('neuink:reader-surface-change', cancel);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('focusin', focus);
      cancel();
    };
  }, [context, enabled, scrollRef]);

  return {
    active,
    onPointerEnter: (event: ReactPointerEvent<HTMLDivElement>) => { hovered.current = !isControl(event.target); },
    onPointerLeave: () => { hovered.current = false; },
    onPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => {
      ignoreClick.current = false;
      if (!enabled || !held.current || pan.current || event.button !== 0 || event.isPrimary === false ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isControl(event.target)) return;
      const element = event.currentTarget;
      const rect = element.getBoundingClientRect();
      // Convert physical pointer movement to the scroll owner's CSS pixels once.
      pan.current = {
        pointerId: event.pointerId, element, startX: event.clientX, startY: event.clientY,
        x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop,
        scaleX: rect.width / element.offsetWidth || 1, scaleY: rect.height / element.offsetHeight || 1,
        moved: false, cursor: document.body.style.cursor, userSelect: document.body.style.userSelect,
      };
      ignoreClick.current = true;
      document.body.style.userSelect = 'none';
      element.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      element.focus({ preventScroll: true });
    },
    onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!ignoreClick.current) return;
      ignoreClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
