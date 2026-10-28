import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { usePointerItemDrag } from '@/shared/lib/usePointerItemDrag';

type Bounds = { width: number; height: number };
export type PinFrame = Bounds & { left: number; top: number };
type Gesture = { mode: 'move' | 'resize'; origin: PinFrame; x: number; y: number; scale: number };
const GAP = 8;

export function clampPinFrame(frame: PinFrame, bounds: Bounds): PinFrame {
  const width = Math.min(Math.max(220, frame.width), Math.max(1, bounds.width - GAP * 2));
  const height = Math.min(Math.max(140, frame.height), Math.max(1, bounds.height - GAP * 2));
  return { width, height,
    left: Math.max(GAP, Math.min(frame.left, bounds.width - width - GAP)),
    top: Math.max(GAP, Math.min(frame.top, bounds.height - height - GAP)) };
}

/** Pin geometry belongs to its own panel; moving it never changes the PDF layout. */
export function usePinnedSegmentFrame(host: HTMLElement, panel: RefObject<HTMLElement>, id: string, offset: number) {
  const [frame, setFrame] = useState<PinFrame | null>(null);
  const current = useRef<PinFrame | null>(null);
  const bounds = useRef<Bounds>({ width: 0, height: 0 });
  const gesture = useRef<Gesture | null>(null);
  const animation = useRef<number | null>(null);
  const pending = useRef<PinFrame | null>(null);
  const paint = useCallback((next: PinFrame) => {
    current.current = next;
    const element = panel.current;
    if (element) Object.assign(element.style, {
      left: `${next.left}px`, top: `${next.top}px`, width: `${next.width}px`, height: `${next.height}px`
    });
  }, [panel]);
  const cancelFrame = useCallback(() => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
    pending.current = null;
  }, []);
  const commit = useCallback((next: PinFrame) => {
    cancelFrame();
    paint(next);
    setFrame(next);
  }, [cancelFrame, paint]);
  const nextFrame = useCallback((item: Gesture, x: number, y: number) => {
    const dx = (x - item.x) / item.scale;
    const dy = (y - item.y) / item.scale;
    return clampPinFrame(item.mode === 'move'
      ? { ...item.origin, left: item.origin.left + dx, top: item.origin.top + dy }
      : { ...item.origin,
        width: Math.min(item.origin.width + dx, bounds.current.width - item.origin.left - GAP),
        height: Math.min(item.origin.height + dy, bounds.current.height - item.origin.top - GAP) }, bounds.current);
  }, []);
  const session = useMemo(() => {
    const update = (x: number, y: number) => {
      if (!gesture.current) return;
      pending.current = nextFrame(gesture.current, x, y);
      if (animation.current !== null) return;
      animation.current = requestAnimationFrame(() => {
        animation.current = null;
        if (pending.current) paint(pending.current);
        pending.current = null;
      });
    };
    return {
      begin(item: Gesture, x: number, y: number) { gesture.current = item; update(x, y); },
      update,
      finish(x: number, y: number) {
        const item = gesture.current;
        gesture.current = null;
        if (item) commit(nextFrame(item, x, y));
      },
      cancel() {
        const item = gesture.current;
        gesture.current = null;
        cancelFrame();
        if (item) commit(item.origin);
      }
    };
  }, [cancelFrame, commit, nextFrame, paint]);
  const drag = usePointerItemDrag(id, session, { autoScroll: false,
    cursor: item => item.mode === 'resize' ? 'nwse-resize' : 'grabbing' });

  useLayoutEffect(() => {
    const measure = () => {
      const nextBounds = { width: host.clientWidth, height: host.clientHeight };
      if (nextBounds.width === bounds.current.width && nextBounds.height === bounds.current.height) return;
      drag.cancel();
      if (!nextBounds.width || !nextBounds.height) return;
      bounds.current = nextBounds;
      const initial = { width: Math.min(420, nextBounds.width * 0.56), height: Math.min(320, nextBounds.height * 0.55),
        left: nextBounds.width - Math.min(420, nextBounds.width * 0.56) - GAP - offset * 24,
        top: GAP + offset * 28 };
      commit(clampPinFrame(current.current ?? initial, nextBounds));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(host);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); cancelFrame(); };
  }, [host, offset, commit, cancelFrame, drag.cancel]);

  const handles = (mode: Gesture['mode']) => ({
    ...drag.pointerHandlers,
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!current.current) return;
      const scale = host.getBoundingClientRect().width / host.clientWidth || 1;
      const item = { mode, origin: current.current, x: event.clientX, y: event.clientY, scale };
      if (drag.handlers(item).onPointerDown(event)) {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
      }
    },
    onClick(event: React.MouseEvent<HTMLElement>) {
      if (drag.consumeDragClick()) { event.preventDefault(); event.stopPropagation(); }
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (!current.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      drag.cancel();
      const step = event.shiftKey ? 20 : 5;
      const x = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const y = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      commit(nextFrame({ mode, origin: current.current, x: 0, y: 0, scale: 1 }, x, y));
    }
  });
  return { frame, move: handles('move'), resize: handles('resize') };
}
