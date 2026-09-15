import { entryContentId, type WorkspacePaneId, type WorkspaceSurface, type WorkspaceSurfaceLayout } from './workspaceSurface';

type EntrySurface = Extract<WorkspaceSurface, { entryId: string }>;

/** Detail navigation follows the focused note, independently of a companion reading paper. */
export function resolveTagNoteSidebarContext(layout: WorkspaceSurfaceLayout) {
  const focused = layout[layout.focusedPane] ?? layout.left;
  return focused.kind === 'owned-note' && focused.target.owner.kind === 'tag_reading' ? focused : null;
}

/** Keep the paper's sidebar available while its tag note is edited in the other pane. */
export function resolveEntrySidebarContext(layout: WorkspaceSurfaceLayout) {
  const pane: WorkspacePaneId = layout.focusedPane === 'right' && layout.right ? 'right' : 'left';
  const focused = layout[pane]!;
  const otherPane = pane === 'left' ? 'right' : 'left';
  const other = layout[otherPane];
  const surface: EntrySurface | null = 'entryId' in focused ? focused
    : focused.kind === 'owned-note' && focused.target.owner.kind === 'entry'
      ? { kind: 'note', entryId: focused.target.owner.entry_id, noteId: focused.target.note_id }
      : focused.kind === 'owned-note' && other && 'entryId' in other ? other : null;
  if (!surface) return null;
  const isReader = surface.kind === 'entry-overview' || surface.kind === 'pdf' || surface.kind === 'reflow';
  const source = isReader ? surface
    : other && 'entryId' in other && other.entryId === surface.entryId && 'contextTagId' in other ? other : null;
  return { surface, entryId: surface.entryId, contentId: entryContentId(surface),
    contextTagId: source?.contextTagId, pane: surface === other ? otherPane : pane };
}
