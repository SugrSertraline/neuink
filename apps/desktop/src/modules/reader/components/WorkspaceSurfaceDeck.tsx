import type { ReactNode } from 'react';
import { surfaceKey, type WorkspaceSurface, type WorkspaceSurfaceLayout, type WorkspacePaneId } from '@/app/workspaceSurface';

/** Keep surfaces in one keyed sibling list: moving panes must not recreate readers/editors. */
export function WorkspaceSurfaceDeck({ layout, onFocus, renderSurface }: {
  layout: WorkspaceSurfaceLayout;
  onFocus: (pane: WorkspacePaneId) => void;
  renderSurface: (surface: WorkspaceSurface, sibling: WorkspaceSurface | null, pane: WorkspacePaneId, active: boolean) => ReactNode;
}) {
  const slots = [
    ...layout.leftTabs.map(surface => ({ surface, pane: 'left' as const })),
    ...layout.rightTabs.map(surface => ({ surface, pane: 'right' as const }))
  ].sort((a, b) => surfaceKey(a.surface).localeCompare(surfaceKey(b.surface)));
  // Even moving an existing DOM node within its parent can reset native scroll.
  // Pane changes therefore only update its CSS grid cell, never DOM order.
  return slots.map(({ surface, pane }) => {
    const activeSurface = layout[pane];
    const active = Boolean(activeSurface && surfaceKey(surface) === surfaceKey(activeSurface));
    return <div key={surfaceKey(surface)}
      className={`workspace-pane workspace-pane-surface${active ? ' is-active' : ''}`}
      style={{ gridColumn: pane === 'left' ? 1 : 3, gridRow: 1 }}
      data-workspace-drop-pane={active ? pane : undefined}
      data-workspace-surface-kind={surface.kind}
      data-workspace-tab-count={pane === 'left' ? layout.leftTabs.length : layout.rightTabs.length}
      onPointerDown={() => onFocus(pane)}>
      {renderSurface(active ? activeSurface! : surface, layout[pane === 'left' ? 'right' : 'left'], pane, active)}
    </div>;
  });
}
