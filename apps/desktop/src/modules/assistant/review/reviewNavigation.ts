/** Scroll only the owning viewport; DOM rectangles include Neuink's CSS UI zoom. */
export function revealReviewTarget(viewport: HTMLElement, target: HTMLElement, padding = 12) {
  const bounds = viewport.getBoundingClientRect();
  const scale = viewport.offsetHeight > 0 ? bounds.height / viewport.offsetHeight : 1;
  viewport.scrollTop += (target.getBoundingClientRect().top - bounds.top) / (scale || 1) - padding;
  target.focus({ preventScroll: true });
}
