// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { LIBRARY_VIEW_STORAGE_KEY, readStoredLibraryView } from './appSupport';
afterEach(() => window.localStorage.clear());
it.each(['unparsed', 'pdf'])('restores the %s library category after reopening', view => {
  window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, view);
  expect(readStoredLibraryView()).toBe(view);
});
it('still falls back to all entries for an invalid stored category', () => {
  window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, 'unknown');
  expect(readStoredLibraryView()).toBe('all');
});
