export type GuideBounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type SpotlightRect = { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number };

const clips = /^(auto|scroll|hidden|clip)$/;

function clipBounds(element: Element, viewport: HTMLElement): GuideBounds | null {
  const root = viewport.getBoundingClientRect();
  let { left, top, right, bottom } = root;
  // Radix menus hide other roots from assistive technology using data-aria-hidden;
  // those roots are still visibly on screen and must retain their spotlight.
  // A closed popup trigger is still visible; only the popup itself is closed.
  if (element.closest('[hidden], [aria-hidden="true"]:not([data-aria-hidden]), .is-hidden, [data-state="closed"]:not([data-slot$="-trigger"])')) return null;
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    if (parent === element) continue;
    // A page or cue can intersect the app viewport but be behind its scroll pane.
    const clipX = clips.test(style.overflowX || style.overflow);
    const clipY = clips.test(style.overflowY || style.overflow);
    if (!clipX && !clipY) continue;
    const bounds = parent.getBoundingClientRect();
    if (clipX) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
    if (clipY) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
  }
  return right > left && bottom > top ? { left, top, right, bottom, width:right - left, height:bottom - top } : null;
}

/** Shared by spotlight, cues, demonstrations and popup permission windows. */
export function getGuideVisibleBounds(element: Element, viewport: HTMLElement, padding: number | { x:number; y:number } = 0): GuideBounds | null {
  const clip = clipBounds(element, viewport);
  if (!clip) return null;
  const bounds = element.getBoundingClientRect();
  // Padding must not reveal an element that is already completely clipped away.
  if (!bounds.width || !bounds.height || bounds.right <= clip.left || bounds.left >= clip.right
    || bounds.bottom <= clip.top || bounds.top >= clip.bottom) return null;
  const padX = typeof padding === 'number' ? padding : padding.x;
  const padY = typeof padding === 'number' ? padding : padding.y;
  const left = Math.max(clip.left, bounds.left - padX);
  const top = Math.max(clip.top, bounds.top - padY);
  const right = Math.min(clip.right, bounds.right + padX);
  const bottom = Math.min(clip.bottom, bounds.bottom + padY);
  return { left, top, right, bottom, width:right - left, height:bottom - top };
}

export function measureGuideSpotlight(element: Element, viewport: HTMLElement, padding = 4): SpotlightRect | null {
  const root = viewport.getBoundingClientRect();
  const scaleX = root.width / (viewport.clientWidth || root.width || 1);
  const scaleY = root.height / (viewport.clientHeight || root.height || 1);
  const bounds = getGuideVisibleBounds(element, viewport, { x:padding * scaleX, y:padding * scaleY });
  if (!bounds) return null;
  return { x:(bounds.left - root.left) / scaleX, y:(bounds.top - root.top) / scaleY,
    width:bounds.width / scaleX, height:bounds.height / scaleY,
    viewportWidth:viewport.clientWidth, viewportHeight:viewport.clientHeight };
}
