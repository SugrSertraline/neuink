// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { preferredScrollBehavior } from './motionPolicy';
afterEach(() => vi.unstubAllGlobals());
it('reads reduced motion at the time of navigation', () => {
  let reduced = true;
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  expect(preferredScrollBehavior()).toBe('instant');
  reduced = false;
  expect(preferredScrollBehavior()).toBe('smooth');
});
