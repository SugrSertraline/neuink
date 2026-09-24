import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type MutableRefObject } from 'react';
import { WORKSPACE_SPLIT_STANDARD_MIN_WIDTH } from './workspaceSplit';

type Options = { width: number; min: number; max: number; enabled: boolean; onCommit: (width: number) => void;
  containerRef?: MutableRefObject<HTMLElement | null> };

export function useSidebarResize({ width, min, max, enabled, onCommit, containerRef }: Options) {
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [availableWidth, setAvailableWidth] = useState(max);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  // A workspace-keyed provider can replace the shell without remounting this hook.
  // An object ref alone does not notify effects that their observed node was removed.
  const observeContainer = useCallback((node: HTMLElement | null) => {
    if (containerRef) containerRef.current = node;
    setContainer(node);
  }, [containerRef]);
  useEffect(() => {
    if (!container) return;
    let active = true;
    const update = () => {
      if (!active || !container.isConnected) return;
      const activityWidth = parseFloat(getComputedStyle(container).getPropertyValue('--app-activity-width')) || 0;
      // Preserve room for the main workspace at high UI zoom; retain the user's preferred width for wider windows.
      setAvailableWidth(Math.max(min, container.clientWidth - activityWidth - WORKSPACE_SPLIT_STANDARD_MIN_WIDTH));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => { active = false; observer.disconnect(); };
  }, [container, min]);
  const maxWidth = Math.min(max, availableWidth);
  const clamp = (value: number) => Math.min(maxWidth, Math.max(min, Math.round(value)));
  const effectiveWidth = clamp(width);
  const cancel = useRef<(() => void) | null>(null);
  const latest = useRef(onCommit); latest.current = onCommit;
  useEffect(() => () => cancel.current?.(), []);
  useEffect(() => { cancel.current?.(); }, [enabled, width, min, maxWidth, container]);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0 || event.isPrimary === false) return;
    cancel.current?.();
    event.preventDefault();
    const handle = event.currentTarget;
    const container = handle.parentElement;
    const layoutWidth = container?.offsetWidth ?? 0;
    const scale = layoutWidth ? (container!.getBoundingClientRect().width / layoutWidth) || 1 : 1;
    const startX = event.clientX;
    const pointerId = event.pointerId;
    const oldCursor = document.body.style.cursor, oldSelection = document.body.style.userSelect;
    let nextWidth = effectiveWidth;
    let moved = false, finished = false, frame: number | null = null;
    handle.setPointerCapture?.(pointerId);
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const distance = next.clientX - startX;
      if (!moved && Math.abs(distance) < 4) return;
      moved = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      nextWidth = clamp(effectiveWidth + distance / scale);
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; setPreviewWidth(nextWidth); });
    };
    const finish = (save: boolean) => {
      if (finished) return;
      finished = true;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', key, true);
      handle.removeEventListener('lostpointercapture', cancelled);
      cancel.current = null;
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      document.body.style.cursor = oldCursor;
      document.body.style.userSelect = oldSelection;
      setPreviewWidth(null);
      if (save && moved) latest.current(nextWidth);
    };
    const up = (next: globalThis.PointerEvent) => { if (next.pointerId === pointerId) finish(true); };
    const cancelled = (next: globalThis.PointerEvent) => { if (next.pointerId === pointerId) finish(false); };
    const blur = () => finish(false);
    const key = (next: globalThis.KeyboardEvent) => {
      if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); finish(false); }
    };
    cancel.current = blur;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelled);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', key, true);
    handle.addEventListener('lostpointercapture', cancelled);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    cancel.current?.();
    latest.current(clamp(effectiveWidth + (event.key === 'ArrowRight' ? 16 : -16)));
  };
  return { previewWidth, onPointerDown, onKeyDown, effectiveWidth, maxWidth, observeContainer };
}
