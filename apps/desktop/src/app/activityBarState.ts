import type { WorkspaceSurface } from './workspaceSurface';

export type SidePanel = 'assistant' | 'library' | 'search';

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
