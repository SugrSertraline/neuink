import type { WorkspaceSurface } from './workspaceSurface';

export type SidePanel = 'assistant' | 'library' | 'details' | 'search' | 'same-tag' | 'daily-dashboard';

/** The rail has one selection; workspace tabs identify the current document separately. */
export function resolveActivityNavigationItem(focusedKind: WorkspaceSurface['kind'], activePanel: SidePanel | null): SidePanel | 'daily-dashboard' | null {
  if (activePanel) return activePanel;
  return focusedKind === 'library' || focusedKind === 'daily-dashboard' ? focusedKind : null;
}

/** Reading focus selects the detail target, never the user's selected side tool. */
export function resolveLibrarySidebarMode(sidePanel: SidePanel, hasEntry: boolean, hasTagNote: boolean) {
  if (sidePanel === 'library') return 'library';
  if (sidePanel !== 'details') return null;
  return hasTagNote ? 'note-details' : hasEntry ? 'entry-details' : 'empty-details';
}

export function resolveActiveActivityPanel({
  sidebarOpen,
  sidePanel
}: {
  focusedSurfaceKind: WorkspaceSurface['kind'];
  sidebarOpen: boolean;
  sidePanel: SidePanel;
}): SidePanel | null {
  if (sidebarOpen) {
    return sidePanel;
  }

  return null;
}
