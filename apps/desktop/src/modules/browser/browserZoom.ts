export const BROWSER_ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export const BROWSER_MIN_ZOOM = BROWSER_ZOOM_LEVELS[0];
export const BROWSER_MAX_ZOOM = BROWSER_ZOOM_LEVELS[BROWSER_ZOOM_LEVELS.length - 1];

/** Native wheel zoom may sit between toolbar steps; move from its actual value. */
export function adjacentBrowserZoom(current: number, direction: -1 | 1): number {
  const value = Number.isFinite(current) && current > 0 ? current : 1;
  return direction > 0
    ? BROWSER_ZOOM_LEVELS.find(level => level > value + 0.001) ?? BROWSER_MAX_ZOOM
    : [...BROWSER_ZOOM_LEVELS].reverse().find(level => level < value - 0.001) ?? BROWSER_MIN_ZOOM;
}
