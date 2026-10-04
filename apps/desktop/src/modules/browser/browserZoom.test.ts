import { describe, expect, it } from 'vitest';
import { adjacentBrowserZoom, BROWSER_MAX_ZOOM, BROWSER_MIN_ZOOM, BROWSER_ZOOM_LEVELS } from './browserZoom';

describe('browser zoom steps', () => {
  it('covers a strictly increasing bounded native zoom range', () => {
    expect(BROWSER_MIN_ZOOM).toBe(0.5);
    expect(BROWSER_MAX_ZOOM).toBe(3);
    expect(BROWSER_ZOOM_LEVELS).toContain(1);
    expect(BROWSER_ZOOM_LEVELS.every((value, index) => index === 0 || value > BROWSER_ZOOM_LEVELS[index - 1])).toBe(true);
  });

  it.each(BROWSER_ZOOM_LEVELS)('advances from %s only to the adjacent step', value => {
    const index = BROWSER_ZOOM_LEVELS.indexOf(value);
    expect(adjacentBrowserZoom(value, -1)).toBe(BROWSER_ZOOM_LEVELS[Math.max(0, index - 1)]);
    expect(adjacentBrowserZoom(value, 1)).toBe(BROWSER_ZOOM_LEVELS[Math.min(BROWSER_ZOOM_LEVELS.length - 1, index + 1)]);
  });

  it('starts from the actual native ratio between steps and tolerates rounding noise', () => {
    expect(adjacentBrowserZoom(1.17, 1)).toBe(1.25);
    expect(adjacentBrowserZoom(1.17, -1)).toBe(1.1);
    expect(adjacentBrowserZoom(1.10001, -1)).toBe(1);
    expect(adjacentBrowserZoom(1.09999, 1)).toBe(1.25);
  });

  it('brings positive out-of-range native ratios back inside the toolbar range', () => {
    expect(adjacentBrowserZoom(0.1, -1)).toBe(0.5);
    expect(adjacentBrowserZoom(0.1, 1)).toBe(0.5);
    expect(adjacentBrowserZoom(4, -1)).toBe(3);
    expect(adjacentBrowserZoom(4, 1)).toBe(3);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])('uses 100%% as the baseline for invalid value %s', value => {
    expect(adjacentBrowserZoom(value, 1)).toBe(1.1);
    expect(adjacentBrowserZoom(value, -1)).toBe(0.9);
  });
});
