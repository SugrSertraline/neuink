import { useLayoutEffect, type RefObject } from 'react';

/** Tiptap owns image attributes; this hook only positions its selected controls.
 * The existing note viewport remains the scroll owner. Never scroll it to
 * compensate for resizing, or recreate a range input during a drag.
 */
export function useNoteImageToolbar({ visible, editorRoot, figureRef, viewportRef, toolbarRef }: {
  visible: boolean;
  editorRoot: HTMLElement;
  figureRef: RefObject<HTMLElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  toolbarRef: RefObject<HTMLDivElement | null>;
}) {
  useLayoutEffect(() => {
    const figure = figureRef.current;
    const viewport = viewportRef.current;
    const toolbar = toolbarRef.current;
    if (!visible || !figure || !viewport || !toolbar) return;
    const scrollOwner = findNoteScrollOwner(figure);
    let frame: number | null = null;
    let pointerId: number | null = null;
    let releaseLayout: (() => void) | null = null;
    let positioned = false;

    const finish = () => {
      pointerId = null;
      releaseLayout?.();
      releaseLayout = null;
    };
    const holdLayout = () => {
      if (releaseLayout) return;
      const anchor = scrollOwner.style.overflowAnchor;
      const minHeight = editorRoot.style.minHeight;
      // Prevent native scrollTop clamping when shrinking the last image.
      scrollOwner.style.overflowAnchor = 'none';
      editorRoot.style.minHeight = `${Math.max(editorRoot.offsetHeight, editorRoot.scrollHeight)}px`;
      releaseLayout = () => {
        scrollOwner.style.overflowAnchor = anchor;
        editorRoot.style.minHeight = minHeight;
      };
    };
    const place = (force = false) => {
      if (releaseLayout && !force) return;
      const image = figure.getBoundingClientRect();
      const owner = scrollOwner.getBoundingClientRect();
      if (!figure.getClientRects().length || image.bottom <= owner.top || image.top >= owner.bottom || !owner.width || !owner.height) {
        toolbar.style.visibility = 'hidden';
        return;
      }
      if (!force && positioned && toolbar.contains(document.activeElement)) return;
      const bounds = viewport.getBoundingClientRect();
      const scale = bounds.width && viewport.clientWidth ? bounds.width / viewport.clientWidth : 1;
      const left = Math.max(owner.left, bounds.left);
      const right = Math.min(owner.right, bounds.right);
      const top = Math.max(owner.top, bounds.top);
      const bottom = Math.min(owner.bottom, bounds.bottom);
      const width = Math.min(360, Math.max(0, (right - left) / scale - 16));
      toolbar.style.width = `${width}px`;
      const height = toolbar.getBoundingClientRect().height;
      const x = left + (right - left - width * scale) / 2;
      const y = Math.max(top + 8 * scale, Math.min(image.bottom + 4 * scale, bottom - height - 8 * scale));
      toolbar.style.left = `${(x - bounds.left) / scale}px`;
      toolbar.style.top = `${(y - bounds.top) / scale}px`;
      toolbar.style.visibility = 'visible';
      positioned = true;
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => { frame = null; place(); });
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || pointerId !== null) return;
      pointerId = event.pointerId;
      holdLayout();
      // Keep the input's native pointer capture and keyboard behavior.
    };
    const pointerEnd = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(); };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { finish(); return; }
      if (event.target instanceof HTMLInputElement && event.key !== 'Tab') holdLayout();
    };
    const keyUp = () => { if (pointerId === null) finish(); };
    const focusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && toolbar.contains(event.relatedTarget)) return;
      finish();
      schedule();
    };
    const resized = () => { finish(); place(true); };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resized);
    observer?.observe(scrollOwner);
    observer?.observe(viewport);
    const image = figure.querySelector('img');
    image?.addEventListener('load', schedule);
    toolbar.addEventListener('pointerdown', pointerDown);
    toolbar.addEventListener('lostpointercapture', pointerEnd);
    toolbar.addEventListener('keydown', keyDown);
    toolbar.addEventListener('keyup', keyUp);
    toolbar.addEventListener('focusout', focusOut);
    window.addEventListener('pointerup', pointerEnd);
    window.addEventListener('pointercancel', pointerEnd);
    window.addEventListener('blur', finish);
    window.addEventListener('resize', resized);
    window.addEventListener('scroll', schedule, true);
    place(true);
    return () => {
      finish();
      observer?.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      image?.removeEventListener('load', schedule);
      toolbar.removeEventListener('pointerdown', pointerDown);
      toolbar.removeEventListener('lostpointercapture', pointerEnd);
      toolbar.removeEventListener('keydown', keyDown);
      toolbar.removeEventListener('keyup', keyUp);
      toolbar.removeEventListener('focusout', focusOut);
      window.removeEventListener('pointerup', pointerEnd);
      window.removeEventListener('pointercancel', pointerEnd);
      window.removeEventListener('blur', finish);
      window.removeEventListener('resize', resized);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [visible, editorRoot, figureRef, viewportRef, toolbarRef]);
}

export function findNoteScrollOwner(element: HTMLElement) {
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (['auto', 'scroll'].includes(getComputedStyle(current).overflowY)) return current;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}
