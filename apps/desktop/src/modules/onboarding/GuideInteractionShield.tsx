import type { SpotlightRect } from './useSpotlight';

type Rect = Pick<SpotlightRect, 'x' | 'y' | 'width' | 'height'>;

/** Subtract the union of the spotlight windows, including overlapping portals.
 * An SVG mask only changes paint, not hit testing; these rectangles stop actual
 * mouse hit testing (and CSS :hover) in every dimmed part of the viewport.
 */
export function guideBlockedRects(width: number, height: number, windows: readonly Rect[]): Rect[] {
  if (!(width > 0 && height > 0)) return [];
  let blocked: Rect[] = [{ x:0, y:0, width, height }];
  for (const window of windows) {
    if (![window.x, window.y, window.width, window.height].every(Number.isFinite)
      || window.width <= 0 || window.height <= 0) continue;
    blocked = blocked.flatMap(rect => {
      const left = Math.max(rect.x, window.x);
      const top = Math.max(rect.y, window.y);
      const right = Math.min(rect.x + rect.width, window.x + window.width);
      const bottom = Math.min(rect.y + rect.height, window.y + window.height);
      if (right <= left || bottom <= top) return [rect];
      return [
        { x:rect.x, y:rect.y, width:rect.width, height:top - rect.y },
        { x:rect.x, y:bottom, width:rect.width, height:rect.y + rect.height - bottom },
        { x:rect.x, y:top, width:left - rect.x, height:bottom - top },
        { x:right, y:top, width:rect.x + rect.width - right, height:bottom - top },
      ].filter(part => part.width > 0 && part.height > 0);
    });
  }
  return blocked;
}

export function GuideInteractionShield({ width, height, windows }: {
  width:number; height:number; windows:readonly Rect[];
}) {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0">
    {guideBlockedRects(width, height, windows).map((rect, index) => <div key={index}
      data-guide-interaction-shield className="pointer-events-auto absolute" style={{
        left:rect.x, top:rect.y, width:rect.width, height:rect.height, touchAction:'none',
      }} />)}
  </div>;
}
