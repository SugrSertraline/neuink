import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { AssistantActiveNote, AssistantActiveSegment, AssistantActiveSurfaceSnapshot } from '@/shared/types/assistant';
import { surfaceKey, surfaceNoteTarget, type WorkspaceSurfaceLayout } from './workspaceSurface';

/** Only the focused surface owns implicit context. A companion/hidden editor is never a target. */
export function assistantSurfaceContext(layout: WorkspaceSurfaceLayout, entries: LibraryEntry[], selected: AssistantActiveSegment | null) {
  const pane = layout.focusedPane === 'right' && layout.right ? 'right' : 'left';
  const focused = layout[pane]!;
  const target = surfaceNoteTarget(focused);
  const entryId = 'entryId' in focused ? focused.entryId : target?.owner.kind === 'entry' ? target.owner.entry_id : null;
  const entry = entries.find(item => item.id === entryId) ?? null;
  const noteId = target?.owner.kind === 'entry' ? target.note_id : focused.kind === 'note-review' ? focused.noteId ?? null : null;
  const content = entry?.contents.find(item => item.kind === 'note' && item.note_id === noteId);
  const note: AssistantActiveNote | null = entry && content ? { entryId: entry.id, entryTitle: entry.title, noteId: content.note_id, noteTitle: content.title } : null;
  const segment = (focused.kind === 'pdf' || focused.kind === 'reflow' || focused.kind === 'segment-notes') && selected?.entryId === entryId
    && (!('segmentUid' in focused) || !focused.segmentUid || focused.segmentUid === selected.segmentUid) ? selected : null;
  const surface: AssistantActiveSurfaceSnapshot = { capturedAt: new Date().toISOString(), entryId, noteId,
    kind: focused.kind, pane, segmentUid: segment?.segmentUid ?? null, surfaceKey: surfaceKey(focused) };
  return { entry, note, segment, surface };
}
