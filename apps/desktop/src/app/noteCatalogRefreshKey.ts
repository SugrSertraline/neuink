import type { TagMeta } from '@/shared/types/domain';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

// Parse progress updates EntryMeta.updated_at frequently, but do not change the
// note catalog. Keep only fields that affect note ownership, titles or sources.
export function noteCatalogRefreshKey(
  tags: TagMeta[],
  entries: LibraryEntry[],
  trashedEntries: LibraryEntry[],
  noteRefreshById: Record<string, number>
) {
  const entryKey = (entry: LibraryEntry) => [
    entry.id,
    entry.title,
    entry.tagIds,
    entry.status,
    entry.contents.map((content) => [content.note_id, content.title])
  ];
  return JSON.stringify([
    tags.map((tag) => [tag.id, tag.name, tag.parent_id]),
    entries.map(entryKey),
    trashedEntries.map(entryKey),
    noteRefreshById
  ]);
}
