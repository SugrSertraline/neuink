import type { TrashItem } from '@/shared/types/domain';
import type { CatalogNote } from '@/shared/ipc/noteCatalogApi';
import type { TagArchive } from '@/shared/ipc/tagReadingApi';

export function planEmptyTrash(items: TrashItem[], archives: TagArchive[], notes: CatalogNote[], externalIds: ReadonlySet<string>) {
  const protectedIds = new Set(items.filter(item => item.kind === 'entry' &&
    (item.source_managed || externalIds.has(item.entry_id))).map(item => item.entry_id));
  const entries = items.filter(item => item.kind === 'entry' && !protectedIds.has(item.entry_id));
  const parentIds = new Set(entries.map(item => item.entry_id));
  const records = items.filter(item => item.kind !== 'entry' && item.stored_trash_item &&
    !protectedIds.has(item.entry_id) && !parentIds.has(item.entry_id));
  // Archived tags own their entire reading directory; never purge its notes twice.
  const archivedTagIds = new Set(archives.flatMap(archive => archive.tags.map(tag => tag.id)));
  const tagNotes = notes.filter(note => note.deleted_at && note.target.owner.kind === 'tag_reading' &&
    !archivedTagIds.has(note.target.owner.tag_id));
  return { entries, records, archives, tagNotes, protectedCount: protectedIds.size };
}

export type TrashPurgeTask = { label: string; run: () => Promise<void> | void };
export async function runTrashPurge(tasks: TrashPurgeTask[], isCurrent: () => boolean, progress: (done: number) => void) {
  const failures: string[] = [];
  let succeeded = 0;
  for (const [index, task] of tasks.entries()) {
    if (!isCurrent()) break;
    try { await task.run(); succeeded += 1; }
    catch (error) { failures.push(`${task.label}：${error instanceof Error ? error.message : String(error)}`); }
    if (isCurrent()) progress(index + 1);
  }
  return { succeeded, failures };
}
