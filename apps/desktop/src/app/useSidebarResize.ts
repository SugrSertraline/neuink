import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type MutableRefObject } from 'react';
import { WORKSPACE_SPLIT_STANDARD_MIN_WIDTH } from './workspaceSplit';

type Options = { width: number; min: number; max: number; enabled: boolean; onCommit: (width: number) => void;
  containerRef?: MutableRefObject<HTMLElement | null>; liveResize?: boolean; onCollapse?: () => void };

const LIVE_WIDTH_PROPERTY = '--app-sidebar-live-width';

export function useSidebarResize({ width, min, max, enabled, onCommit, containerRef, liveResize = false, onCollapse }: Options) {
  // Readers normally use a guide-only drag. Visible native webpages also need
  // actual layout changes, but neither path should update App state per frame.
  const previewRef = useRef<HTMLDivElement | null>(null);
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
    let restoreTimer: number | null = null;
    let restoring = false;
    const update = () => {
      if (!active || !container.isConnected) return;
      if (container.clientWidth <= 0) return;
      const activityWidth = parseFloat(getComputedStyle(container).getPropertyValue('--app-activity-width')) || 0;
      // Preserve room for the main workspace at high UI zoom; retain the user's preferred width for wider windows.
      setAvailableWidth(Math.max(min, container.clientWidth - activityWidth - WORKSPACE_SPLIT_STANDARD_MIN_WIDTH));
    };
    const scheduleRestore = () => {
      restoring = true;
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      // WebView2 reports several provisional sizes before its surface returns.
      restoreTimer = window.setTimeout(() => {
        restoreTimer = null;
        restoring = false;
        update();
      }, 400);
    };
    const suspend = () => {
      restoring = true;
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
      restoreTimer = null;
    };
    update();
    const observer = new ResizeObserver(() => {
      if (!restoring && !document.hidden) update();
    });
    observer.observe(container);
    window.addEventListener('blur', suspend);
    window.addEventListener('focus', scheduleRestore);
    const onVisibilityChange = () => document.hidden ? suspend() : scheduleRestore();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener('blur', suspend);
      window.removeEventListener('focus', scheduleRestore);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (restoreTimer !== null) window.clearTimeout(restoreTimer);
    };
  }, [container, min]);
  const maxWidth = Math.min(max, availableWidth);
  const clamp = (value: number) => Math.min(maxWidth, Math.max(min, Math.round(value)));
  const effectiveWidth = clamp(width);
  const cancel = useRef<(() => void) | null>(null);
  const latest = useRef(onCommit); latest.current = onCommit;
  const collapse = useRef(onCollapse); collapse.current = onCollapse;
  useEffect(() => () => cancel.current?.(), []);
  useEffect(() => { cancel.current?.(); }, [enabled, width, min, maxWidth, container, liveResize]);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0 || event.isPrimary === false) return;
    cancel.current?.();
    event.preventDefault();
    const handle = event.currentTarget;
    const container = handle.parentElement;
    const preview = previewRef.current;
    const layoutWidth = container?.offsetWidth ?? 0;
    const scale = layoutWidth ? (container!.getBoundingClientRect().width / layoutWidth) || 1 : 1;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const oldCursor = document.body.style.cursor, oldSelection = document.body.style.userSelect;
    const oldLiveWidth = container?.style.getPropertyValue(LIVE_WIDTH_PROPERTY) ?? '';
    const oldLivePriority = container?.style.getPropertyPriority(LIVE_WIDTH_PROPERTY) ?? '';
    let nextWidth = effectiveWidth;
    let renderedWidth: number | null = null;
    let moved = false, finished = false, appliedLiveWidth = false, frame: number | null = null;
    handle.setPointerCapture?.(pointerId);
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const distance = next.clientX - startX;
      if (!moved && Math.hypot(distance, next.clientY - startY) < 4) return;
      if (!moved) {
        moved = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        container?.classList.add('is-sidebar-resizing');
      }
      nextWidth = clamp(effectiveWidth + distance / scale);
      if (frame === null && nextWidth !== renderedWidth) frame = requestAnimationFrame(() => {
        frame = null;
        if (finished || !preview?.isConnected || nextWidth === renderedWidth) return;
        preview.style.setProperty('--app-sidebar-preview-width', `${nextWidth}px`);
        preview.hidden = false;
        if (liveResize && container?.isConnected) {
          // Separate from React's committed style, so unrelated renders cannot
          // restore the old width before the pointer is released.
          container.style.setProperty(LIVE_WIDTH_PROPERTY, `${nextWidth}px`);
          appliedLiveWidth = true;
        }
        renderedWidth = nextWidth;
      });
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
      container?.classList.remove('is-sidebar-resizing');
      if (appliedLiveWidth && container) {
        if (oldLiveWidth) container.style.setProperty(LIVE_WIDTH_PROPERTY, oldLiveWidth, oldLivePriority);
        else container.style.removeProperty(LIVE_WIDTH_PROPERTY);
      }
      if (preview) {
        preview.hidden = true;
        preview.style.removeProperty('--app-sidebar-preview-width');
      }
      if (save && moved) latest.current(nextWidth);
      if (save && !moved) collapse.current?.();
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
    if (enabled && collapse.current && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      cancel.current?.();
      if (!event.repeat) collapse.current();
      return;
    }
    if (!enabled || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    cancel.current?.();
    latest.current(clamp(effectiveWidth + (event.key === 'ArrowRight' ? 16 : -16)));
  };
  return { previewRef, onPointerDown, onKeyDown, effectiveWidth, maxWidth, observeContainer };
}
