import type { WorkspacePaneId, WorkspaceSurface, WorkspaceSurfaceLayout } from './workspaceSurface';

type SourceReader = Extract<WorkspaceSurface, { kind: 'pdf' | 'reflow' }>;

/** Prefer a visible reader before looking through inactive tabs; clicking a note
 * may already have moved focus away from the source in the other pane. */
export function resolveSourceLinkSurface(
  state: WorkspaceSurfaceLayout,
  entryId: string,
  originPane: WorkspacePaneId = state.focusedPane
): { surface: SourceReader; pane: WorkspacePaneId } {
  const matches = (surface: WorkspaceSurface | null): surface is SourceReader =>
    Boolean(surface && (surface.kind === 'pdf' || surface.kind === 'reflow') && surface.entryId === entryId);
  const focused = state[state.focusedPane];
  if (matches(focused)) return { surface: focused, pane: state.focusedPane };
  const opposite = originPane === 'left' ? 'right' : 'left';
  for (const pane of [opposite, originPane] as const) {
    const surface = state[pane];
    if (matches(surface)) return { surface, pane };
  }
  // An inactive reader from the note's pane can move beside it without replacing
  // the note. Keep the exact surface identity, mode, tag context and view copy.
  const existing = [...state[`${opposite}Tabs`], ...state[`${originPane}Tabs`]].find(matches);
  return { surface: existing ?? { kind: 'pdf', entryId }, pane: opposite };
}
