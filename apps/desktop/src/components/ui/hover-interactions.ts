import { useCallback, useEffect, useRef, useState } from 'react';

export const HOVER_TIMING = { open: 350, close: 150, reader: 180, tooltip: 500, skip: 200 } as const;
export const HOVER_SURFACE_CLASS = 'rounded-lg border border-border bg-popover text-popover-foreground shadow-md';

type DismissEvent = { type: string; target?: EventTarget | null };
type Listener = (event: DismissEvent) => boolean | void;
const listeners = new Set<Listener>();
let pointerDown = false;
let dragging = false;

export function hoverInteractionBlocked() {
  return pointerDown || dragging || (typeof document !== 'undefined' && document.visibilityState === 'hidden');
}

function emit(event: DismissEvent) {
  let dismissed = false;
  listeners.forEach((listener) => { if (listener(event)) dismissed = true; });
  return dismissed;
}

/** One document subscription shared by all mounted hover triggers, including pending timers. */
function listen(listener: Listener) {
  listeners.add(listener);
  if (listeners.size === 1) attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach();
  };
}

function handlePointerDown(event: PointerEvent) { pointerDown = true; emit(event); }
function handlePointerMove(event: PointerEvent) {
  // A release outside the window may have no pointerup in this document.
  if (event.buttons === 0) releasePointer();
  else if (!pointerDown) handlePointerDown(event);
}
function releasePointer() { pointerDown = false; }
function handleDragStart(event: Event) { dragging = true; emit(event); }
function handleDragEnd() { dragging = false; pointerDown = false; }
function handleBlur(event: Event) { handleDragEnd(); emit(event); }
function handleKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && emit(event)) {
    // Native events may flush React before Radix handles Escape. Consume it while
    // the preview still owns it, so the underlying dialog stays open.
    event.preventDefault();
    event.stopPropagation();
  }
}
function handleVisibility(event: Event) { if (document.visibilityState === 'hidden') handleBlur(event); }

function attach() {
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('pointermove', handlePointerMove, true);
  document.addEventListener('pointerup', releasePointer, true);
  document.addEventListener('pointercancel', releasePointer, true);
  document.addEventListener('dragstart', handleDragStart, true);
  document.addEventListener('dragend', handleDragEnd, true);
  document.addEventListener('drop', handleDragEnd, true);
  document.addEventListener('contextmenu', emit, true);
  document.addEventListener('keydown', handleKey, true);
  document.addEventListener('scroll', emit, true);
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('blur', handleBlur);
  window.addEventListener('resize', emit);
  window.addEventListener('neuink:reader-surface-change', emit);
}

function detach() {
  document.removeEventListener('pointerdown', handlePointerDown, true);
  document.removeEventListener('pointermove', handlePointerMove, true);
  document.removeEventListener('pointerup', releasePointer, true);
  document.removeEventListener('pointercancel', releasePointer, true);
  document.removeEventListener('dragstart', handleDragStart, true);
  document.removeEventListener('dragend', handleDragEnd, true);
  document.removeEventListener('drop', handleDragEnd, true);
  document.removeEventListener('contextmenu', emit, true);
  document.removeEventListener('keydown', handleKey, true);
  document.removeEventListener('scroll', emit, true);
  document.removeEventListener('visibilitychange', handleVisibility);
  window.removeEventListener('blur', handleBlur);
  window.removeEventListener('resize', emit);
  window.removeEventListener('neuink:reader-surface-change', emit);
  handleDragEnd();
}

export function useHoverDismiss(onDismiss: () => boolean | void, enabled = true) {
  const callbackRef = useRef(onDismiss);
  callbackRef.current = onDismiss;
  useEffect(() => {
    if (!enabled) return;
    return listen((event) => {
      // Reading/selection inside any hover preview is still a hover interaction.
      // Scrolling the document, clicking its trigger, or opening a menu dismisses it.
      if ((event.type === 'scroll' || event.type === 'pointerdown') &&
        event.target instanceof Element && event.target.closest('[data-hover-surface]')) return;
      return callbackRef.current();
    });
  }, [enabled]);
}

/** Shared gate for Radix roots: dismissal also cancels delayed opens until a new entry/focus. */
function useHoverGate(onDismiss: () => boolean) {
  const dismissed = useRef(false);
  useHoverDismiss(() => { dismissed.current = true; return onDismiss(); });
  const rearm = useCallback(() => { if (!hoverInteractionBlocked()) dismissed.current = false; }, []);
  const canOpen = useCallback(() => !dismissed.current && !hoverInteractionBlocked(), []);
  return { rearm, canOpen };
}

export function useHoverOpenState({ open: controlledOpen, defaultOpen = false, onOpenChange }: {
  open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  const openRef = useRef(open);
  openRef.current = open;
  const change = (next: boolean) => {
    // Radix and the shared dismissal listener can observe the same Escape event.
    if (openRef.current === next) return false;
    openRef.current = next;
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
    return true;
  };
  const gate = useHoverGate(() => change(false));
  return {
    open,
    rearm: gate.rearm,
    show: () => { gate.rearm(); if (gate.canOpen()) change(true); },
    onOpenChange: (next: boolean) => { if (!next || gate.canOpen()) change(next); },
  };
}

/** Pointer-driven readers keep their own hit testing; only preview timing/lifecycle is shared. */
export function useReaderPreviewVisible(key: string) {
  const [visibleKey, setVisibleKey] = useState<string | null>(null);
  const visible = visibleKey === key;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const cancel = () => { clearTimeout(timer.current); setVisibleKey(null); return visible; };
  useHoverDismiss(cancel);
  useEffect(() => {
    setVisibleKey(null);
    timer.current = setTimeout(() => {
      if (!hoverInteractionBlocked()) setVisibleKey(key);
    }, HOVER_TIMING.reader);
    return () => clearTimeout(timer.current);
  }, [key]);
  return visible;
}
