import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { collectDescendantTagIds } from '@/modules/library/utils/tagTree';
import type { NoteTarget, TagMeta } from '@/shared/types/domain';
import { resolveEntrySidebarContext } from './entrySidebarContext';
import { findSurfacePane, noteSurface, surfaceKey, workspaceSurfaceOpenActions, workspaceSurfaceReducer, type WorkspaceSurface, type WorkspaceSurfaceAction, type WorkspaceSurfaceLayout } from './workspaceSurface';

export function tagNoteOpenPane(layout: WorkspaceSurfaceLayout, target: NoteTarget, split = false) {
  const existing = findSurfacePane(layout, surfaceKey(noteSurface(target)));
  if (!split) return existing ?? (layout.focusedPane === 'right' && layout.right ? 'right' : 'left');
  const paper = resolveEntrySidebarContext(layout);
  return (paper?.pane ?? layout.focusedPane) === 'right' ? 'left' : 'right';
}

export function sameTagEntries(entries: LibraryEntry[], tags: TagMeta[], tagId: string | null, descendants: boolean) {
  if (!tagId || !tags.some(tag => tag.id === tagId)) return [];
  const ids = descendants ? collectDescendantTagIds(tags, tagId) : new Set([tagId]);
  return entries.filter(entry => entry.tagIds.some(id => ids.has(id)));
}

export function tagReadingSurface(entry: LibraryEntry, tagId?: string): WorkspaceSurface {
  return { kind: entry.pdfFileName ? 'pdf' : entry.status === 'Parsed' ? 'reflow' : 'entry-overview', entryId: entry.id, contextTagId: tagId };
}

export function tagReadingMoveTargets(layout: WorkspaceSurfaceLayout, actions: WorkspaceSurfaceAction[]) {
  return actions.flatMap(action => {
    if (action.type !== 'move') return [];
    const pane = findSurfacePane(layout, action.key);
    const surface = [...layout.leftTabs, ...layout.rightTabs].find(item => surfaceKey(item) === action.key);
    return pane && surface ? [{ pane, surface }] : [];
  });
}

/** Use ordinary workspace tabs and preserve all existing work, including the right pane. */
export function startTagReadingActions(layout: WorkspaceSurfaceLayout, entries: LibraryEntry[], tagId: string): WorkspaceSurfaceAction[] {
  if (!entries.length) return [];
  const first = entries.find(entry => 'entryId' in layout.left && entry.id === layout.left.entryId) ?? entries[0];
  let next = layout;
  const actions: WorkspaceSurfaceAction[] = [];
  const open = (surface: WorkspaceSurface, pane: 'left' | 'right') => {
    const steps = workspaceSurfaceOpenActions(next, surface, pane);
    steps.forEach(action => { actions.push(action); next = workspaceSurfaceReducer(next, action); });
  };
  open(tagReadingSurface(first, tagId), 'left');
  if (!next.right) {
    const second = entries.find(entry => entry.id !== first.id);
    open(second ? tagReadingSurface(second, tagId)
      : first.pdfFileName || first.status === 'Parsed' ? { kind: 'entry-overview', entryId: first.id, contextTagId: tagId }
      : { kind: 'library' }, 'right');
  }
  actions.push({ type: 'focus', pane: 'left' });
  return actions;
}
