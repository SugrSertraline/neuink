import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const READING_SPLIT_DIVIDER_WIDTH = 4;
const READING_SPLIT_MIN_PANE_WIDTH = 360;

export function resolveReadingSplitRatio(ratio: number, width: number) {
  if (width <= 0) return ratio;
  const availableWidth = Math.max(0, width - READING_SPLIT_DIVIDER_WIDTH);
  const requestedWidth = Math.min(0.8, Math.max(0.2, ratio)) * width;
  const compactMinimum = Math.floor(availableWidth / 2);
  const minLeftWidth = Math.min(READING_SPLIT_MIN_PANE_WIDTH, compactMinimum);
  const maxLeftWidth = availableWidth - minLeftWidth;
  return Math.min(maxLeftWidth, Math.max(minLeftWidth, requestedWidth)) / width;
}

export function useReadingSplit(ratio: number, onChange: (ratio: number) => Promise<boolean>, enabled: boolean, width: number) {
  const [preview, setPreview] = useState<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const options = useRef({ ratio, onChange, enabled });
  options.current = { ratio, onChange, enabled };
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => { if (!enabled) cleanup.current?.(); }, [enabled]);

  const commit = async (next: number) => {
    setPreview(next);
    try { await options.current.onChange(next); }
    finally { setPreview(null); }
  };
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!options.current.enabled || event.button !== 0 || event.isPrimary === false) return;
    cleanup.current?.();
    const handle = event.currentTarget;
    const container = handle.parentElement;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const physicalWidth = bounds.width;
    if (!physicalWidth) return;
    const start = event.clientX;
    const id = event.pointerId;
    let moved = false;
    let next = options.current.ratio;
    const oldCursor = document.body.style.cursor;
    const oldSelection = document.body.style.userSelect;
    handle.setPointerCapture(id);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      if (!moved && Math.abs(e.clientX - start) < 4) return;
      moved = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      next = resolveReadingSplitRatio((e.clientX - bounds.left) / physicalWidth, width);
      setPreview(next);
    };
    const finish = (save: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', key);
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      document.body.style.cursor = oldCursor;
      document.body.style.userSelect = oldSelection;
      cleanup.current = null;
      if (save && moved) void commit(next); else setPreview(null);
    };
    const up = (e: PointerEvent) => { if (e.pointerId === id) finish(true); };
    const cancel = (e: PointerEvent) => { if (e.pointerId === id) finish(false); };
    const blur = () => finish(false);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
    cleanup.current = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', key);
  };
  const effectiveRatio = resolveReadingSplitRatio(preview ?? ratio, width);
  const divider = <div role="separator" aria-label="调整双篇阅读宽度" aria-orientation="vertical"
    aria-valuemin={Math.round(resolveReadingSplitRatio(0.2, width) * 100)} aria-valuemax={Math.round(resolveReadingSplitRatio(0.8, width) * 100)} aria-valuenow={Math.round(effectiveRatio * 100)}
    aria-disabled={!enabled} tabIndex={enabled ? 0 : -1}
    className="w-1 shrink-0 cursor-col-resize touch-none bg-border hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
    onPointerDown={pointerDown} onKeyDown={(event) => {
      if (!enabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0.2 : event.key === 'End' ? 0.8 : effectiveRatio + (event.key === 'ArrowLeft' ? -0.03 : 0.03);
      void commit(resolveReadingSplitRatio(next, width));
    }} />;
  return { ratio: effectiveRatio, resizing: preview !== null, divider };
}
