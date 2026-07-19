import { describe, expect, it } from 'vitest';

import { resolveActiveActivityPanel } from './activityBarState';

describe('resolveActiveActivityPanel', () => {
  it('keeps library and assistant mutually exclusive when library is focused', () => {
    expect(
      resolveActiveActivityPanel({
        focusedSurfaceKind: 'library',
        sidebarOpen: true,
        sidePanel: 'assistant'
      })
    ).toBe('assistant');
  });

  it('uses the open drawer as the only active activity item', () => {
    expect(
      resolveActiveActivityPanel({
        focusedSurfaceKind: 'pdf',
        sidebarOpen: true,
        sidePanel: 'search'
      })
    ).toBe('search');
    expect(
      resolveActiveActivityPanel({
        focusedSurfaceKind: 'library',
        sidebarOpen: true,
        sidePanel: 'library'
      })
    ).toBe('library');
  });

  it('lets settings override an open side drawer', () => {
    expect(
      resolveActiveActivityPanel({
        focusedSurfaceKind: 'settings',
        sidebarOpen: true,
        sidePanel: 'assistant'
      })
    ).toBeNull();
  });

  it('falls back to library only when its drawer is collapsed on the library surface', () => {
    expect(
      resolveActiveActivityPanel({
        focusedSurfaceKind: 'library',
        sidebarOpen: false,
        sidePanel: 'assistant'
      })
    ).toBe('library');
    expect(
      resolveActiveActivityPanel({
        focusedSurfaceKind: 'pdf',
        sidebarOpen: false,
        sidePanel: 'library'
      })
    ).toBeNull();
  });
});
