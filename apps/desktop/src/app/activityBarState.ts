import type { WorkspaceSurface } from './workspaceSurface';

export type SidePanel = 'assistant' | 'library' | 'details' | 'search' | 'same-tag';

/** Reading focus selects the detail target, never the user's selected side tool. */
export function resolveLibrarySidebarMode(sidePanel: SidePanel, hasEntry: boolean, hasTagNote: boolean) {
  if (sidePanel === 'library') return 'library';
  if (sidePanel !== 'details') return null;
  return hasTagNote ? 'note-details' : hasEntry ? 'entry-details' : 'empty-details';
}

export function resolveActiveActivityPanel({
  focusedSurfaceKind,
  sidebarOpen,
  sidePanel
}: {
  focusedSurfaceKind: WorkspaceSurface['kind'];
  sidebarOpen: boolean;
  sidePanel: SidePanel;
}): SidePanel | null {
  if (focusedSurfaceKind === 'settings') {
    return null;
  }

  if (sidebarOpen) {
    return sidePanel;
  }

  return focusedSurfaceKind === 'library' ? 'library' : null;
}
