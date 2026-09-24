import { describe, expect, it } from 'vitest';

import { resolveActiveActivityPanel, resolveLibrarySidebarMode, type SidePanel } from './activityBarState';
import { defaultEntryContentId, entryContentSurface, initialWorkspaceSurfaceLayout, workspaceSurfaceReducer } from './workspaceSurface';
import { resolveEntrySidebarContext } from './entrySidebarContext';

describe('entry opening preserves the selected side tool', () => {
  it.each<SidePanel>(['library', 'assistant', 'search', 'same-tag', 'details'])('keeps %s selected for either configured content target and a collapsed sidebar', sidePanel => {
    for (const preferPdf of [true, false]) {
      const surface = entryContentSurface('paper', defaultEntryContentId({ pdfFileName: 'paper.pdf' }, preferPdf));
      const opened = workspaceSurfaceReducer(initialWorkspaceSurfaceLayout, { type: 'open', surface });
      expect(opened.left.kind).toBe(preferPdf ? 'pdf' : 'entry-overview');
      expect(resolveActiveActivityPanel({ focusedSurfaceKind: opened.left.kind, sidebarOpen: true, sidePanel })).toBe(sidePanel);
      expect(resolveActiveActivityPanel({ focusedSurfaceKind: opened.left.kind, sidebarOpen: false, sidePanel })).toBeNull();
      const context = resolveEntrySidebarContext(opened);
      expect(resolveLibrarySidebarMode(sidePanel, Boolean(context), false)).toBe(
        sidePanel === 'library' ? 'library' : sidePanel === 'details' ? 'entry-details' : null,
      );
    }
  });

  it('requires selecting details explicitly and retains an empty details view when the target closes', () => {
    expect(resolveLibrarySidebarMode('library', true, true)).toBe('library');
    expect(resolveLibrarySidebarMode('details', true, false)).toBe('entry-details');
    expect(resolveLibrarySidebarMode('details', true, true)).toBe('note-details');
    expect(resolveLibrarySidebarMode('details', false, false)).toBe('empty-details');
    expect(resolveLibrarySidebarMode('search', true, true)).toBeNull();
    expect(resolveLibrarySidebarMode('assistant', true, true)).toBeNull();
  });
});

describe('resolveActiveActivityPanel', () => {
  it('keeps the selected side tool active while the relations tab is focused', () => {
    expect(resolveActiveActivityPanel({ focusedSurfaceKind: 'relations', sidebarOpen: true, sidePanel: 'library' })).toBe('library');
    expect(resolveActiveActivityPanel({ focusedSurfaceKind: 'relations', sidebarOpen: true, sidePanel: 'assistant' })).toBe('assistant');
    expect(resolveActiveActivityPanel({ focusedSurfaceKind: 'relations', sidebarOpen: false, sidePanel: 'library' })).toBeNull();
  });
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
