import type { ReactNode } from 'react';

/** One concrete grid cell owns sidebar paint and clipping, including retained tool panels. */
export function WorkspaceSidebar({ open, children }: { open: boolean; children: ReactNode }) {
  return <div className="workspace-sidebar" hidden={!open} style={{ display: open ? 'grid' : 'none' }}>{children}</div>;
}

/** Keep editors mounted without display:contents or letting hidden panels enter the shell grid. */
export function SidebarPanelSlot({ active, children }: { active: boolean; children: ReactNode }) {
  return <div data-sidebar-panel-slot hidden={!active} style={{ display: active ? 'flex' : 'none' }}>{children}</div>;
}
