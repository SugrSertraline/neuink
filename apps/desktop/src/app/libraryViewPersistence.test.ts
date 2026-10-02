// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { LIBRARY_VIEW_STORAGE_KEY, readStoredLibraryView } from './appSupport';
afterEach(() => window.localStorage.clear());
it('restores the unparsed library category after reopening', () => {
  window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, 'unparsed');
  expect(readStoredLibraryView()).toBe('unparsed');
});
it('still falls back to all entries for an invalid stored category', () => {
  window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, 'unknown');
  expect(readStoredLibraryView()).toBe('all');
});
