/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import { revealReviewTarget } from './reviewNavigation';

it.each([1, 1.25, 1.5])('scrolls only the local viewport at UI scale %s', scale => {
  const viewport = document.createElement('div');
  const target = document.createElement('section');
  Object.defineProperty(viewport, 'offsetHeight', { value: 600 });
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 600 * scale } as DOMRect);
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 100 + 200 * scale } as DOMRect);
  const focus = vi.spyOn(target, 'focus');
  viewport.scrollTop = 40;
  revealReviewTarget(viewport, target);
  expect(viewport.scrollTop).toBe(228);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
});
