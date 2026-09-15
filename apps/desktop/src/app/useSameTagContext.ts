import { useState } from 'react';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { TagMeta } from '@/shared/types/domain';
import { resolveEntrySidebarContext } from './entrySidebarContext';
import { sameTagEntries } from './tagReadingNavigation';
import type { WorkspaceSurfaceLayout } from './workspaceSurface';

/** Browsing scope belongs to the workspace session; focus only supplies the active paper. */
export function useSameTagContext(root: string | null, layout: WorkspaceSurfaceLayout, entries: LibraryEntry[], tags: TagMeta[], libraryTag: string | null, enabled = true) {
  const context = resolveEntrySidebarContext(layout);
  const entry = entries.find(item => item.id === context?.entryId);
  const focused = layout[layout.focusedPane] ?? layout.left;
  const valid = (id: string | null | undefined) => id && tags.some(tag => tag.id === id) ? id : null;
  const origin = valid(context?.contextTagId);
  const ownTag = entry?.tagIds.find(id => valid(id)) ?? null;
  // A recorded origin can outlive the paper's membership in that tag.
  const usableOrigin = entry && sameTagEntries([entry], tags, origin, true).length ? origin : null;
  const noteTag = focused.kind === 'owned-note' && focused.target.owner.kind === 'tag_reading' ? valid(focused.target.owner.tag_id) : null;
  const automatic = entry ? usableOrigin ?? ownTag : noteTag ?? (!context ? valid(libraryTag) : null);
  const initial = () => ({ root, initialized: enabled, tagId: automatic, descendants: true, revision: 0,
    reason: usableOrigin ? '进入来源' : entry && ownTag ? '条目标签' : automatic ? '当前标签' : '全部标签' });
  const [selection, setSelection] = useState(initial);
  // Wait for the first visible, loaded sidebar before capturing the initial scope.
  const current = selection.root !== root || (!selection.initialized && enabled) ? initial() : selection;
  if (selection !== current) setSelection(current);
  return {
    contextKey: JSON.stringify([root, current.revision]),
    entryId: entry?.id ?? null,
    tagId: current.tagId,
    descendants: current.descendants,
    reason: current.reason,
    selectTag: (tagId: string | null) => setSelection({ ...current, initialized: true, tagId, reason: tagId ? '手动选择' : '全部标签' }),
    locateTag: (tagId: string) => setSelection({ ...current, initialized: true, tagId, revision: current.revision + 1, reason: '定位所属标签' }),
    setDescendants: (descendants: boolean) => setSelection({ ...current, descendants }),
    startReading: (tagId: string) => setSelection({ ...current, initialized: true, tagId, descendants: true, revision: current.revision + 1, reason: '进入来源' }),
    locateEntry: () => {
      if (entry) setSelection({ ...current, initialized: true, tagId: usableOrigin ?? ownTag, descendants: true, reason: '定位当前论文' });
    }
  };
}
