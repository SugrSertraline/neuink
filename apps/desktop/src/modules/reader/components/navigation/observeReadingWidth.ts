import type { ReadingAdapter, ReadingPosition } from './ReadingNavigation';

/** Reflow needs a content anchor, not the old scrollTop, when line wrapping changes. */
export function observeReadingWidth(element: HTMLDivElement, adapter: ReadingAdapter) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  let width = element.clientWidth;
  let position: ReadingPosition | null = width > 0 ? adapter.capture() : null;
  let frame = 0;
  let restoring = false;
  const capture = () => {
    // Resize-induced scroll events must not replace the pre-layout anchor.
    if (!restoring && element.clientWidth > 0 && element.clientWidth === width) position = adapter.capture();
  };
  const cancel = () => { cancelAnimationFrame(frame); adapter.cancelRestore?.(); restoring = false; };
  const key = (event: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel();
  };
  const observer = new ResizeObserver(() => {
    const next = element.clientWidth;
    if (next <= 0) { cancel(); return; }
    if (next === width) return;
    width = next;
    cancelAnimationFrame(frame);
    if (!position) { capture(); return; }
    const anchor = position;
    restoring = true;
    frame = requestAnimationFrame(() => {
      adapter.restore(anchor);
      // The virtualizer measures the target row on the next frame.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => { restoring = false; capture(); });
        });
      });
    });
  });
  observer.observe(element);
  element.addEventListener('scroll', capture, { passive: true });
  element.addEventListener('wheel', cancel, { passive: true });
  element.addEventListener('pointerdown', cancel);
  element.addEventListener('keydown', key);
  element.addEventListener('neuink:reading-navigation', cancel);
  return () => {
    cancel(); observer.disconnect();
    element.removeEventListener('scroll', capture);
    element.removeEventListener('wheel', cancel);
    element.removeEventListener('pointerdown', cancel);
    element.removeEventListener('keydown', key);
    element.removeEventListener('neuink:reading-navigation', cancel);
  };
}
