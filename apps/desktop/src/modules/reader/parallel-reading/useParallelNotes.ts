import { useCallback, useEffect, useRef, useState } from 'react';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { NoteDocument, NoteOwner, NoteTarget, SourceLink } from '@/shared/types/domain';
import { createOwnedNote, listTagNotes, setTagNoteDeleted, type TagNoteSummary } from '@/shared/ipc/noteOwnerApi';
import { sameNoteTarget } from '@/shared/lib/noteOwner';
import { useOwnedNote } from '@/modules/notes/useOwnedNote';
import { useWorkspaceNotes } from '@/modules/notes/WorkspaceNotesContext';

export type ParallelNoteOption = { target: NoteTarget; title: string; ownerTitle: string; deleted?: boolean; revision?: string; error?: string | null };
export type EntryNoteSave = (entryId: string, noteId: string, title: string, markdown: string, links?: SourceLink[] | null, revision?: string | null) => Promise<NoteDocument>;

export function useParallelNotes({ root, tagId, tagTitle, entries, memberIds, target, open, refreshKey, onSaveEntryNote, onRefreshEntries }: {
  root: string | null; tagId: string; tagTitle: string; entries: LibraryEntry[]; memberIds: string[];
  target: NoteTarget | null; open: boolean; refreshKey: string;
  onSaveEntryNote: EntryNoteSave; onRefreshEntries: () => Promise<void> | void;
}) {
  const catalog = useWorkspaceNotes();
  const owned = useOwnedNote(root, target, onSaveEntryNote);
  const [tagNotes, setTagNotes] = useState<TagNoteSummary[]>([]);
  const [extra, setExtra] = useState<ParallelNoteOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const context = useRef({ root, live: true }); context.current.root = root;
  useEffect(() => { context.current.live = true; return () => { context.current.live = false; }; }, []);
  const requested = open || target?.owner.kind === 'tag_reading';
  useEffect(() => {
    if (!root || !requested || catalog) return;
    let cancelled = false;
    setLoading(true); setError(null);
    void listTagNotes(root, tagId).then((notes) => { if (!cancelled) setTagNotes(notes); })
      .catch((caught) => { if (!cancelled) setError(String(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root, tagId, requested, refreshKey, reloadKey, Boolean(catalog)]);
  const reload = useCallback(() => { setReloadKey((value) => value + 1); catalog?.refresh(); }, [catalog?.refresh]);
  const options: ParallelNoteOption[] = entries.filter((entry) => memberIds.includes(entry.id) || (target?.owner.kind === 'entry' && target.owner.entry_id === entry.id))
    .flatMap((entry) => entry.contents.flatMap((item) => item.kind === 'note'
      ? [{ target: { owner: { kind: 'entry' as const, entry_id: entry.id }, note_id: item.note_id }, title: item.title, ownerTitle: entry.title }] : []));
  options.unshift(...tagNotes.map((note) => ({ target: { owner: { kind: 'tag_reading' as const, tag_id: tagId }, note_id: note.note_id }, title: note.title, ownerTitle: `标签综合笔记 · ${tagTitle}`, deleted: Boolean(note.deleted_at), revision: note.revision })));
  if (catalog) {
    options.length = 0;
    options.push(...catalog.catalog.notes.filter((note) => note.target.owner.kind === 'tag_reading' ? note.target.owner.tag_id === tagId
      : memberIds.includes(note.target.owner.entry_id) || sameNoteTarget(note.target, target)).map((note) => ({ target: note.target, title: note.title,
      ownerTitle: `${note.target.owner.kind === 'tag_reading' ? '标签笔记' : '条目笔记'} · ${note.owner_title}`, deleted: Boolean(note.deleted_at), revision: note.revision, error: note.error })));
  }
  for (const option of extra) if (!options.some((item) => sameNoteTarget(item.target, option.target))) options.push(option);

  const create = async (owner: NoteOwner, title: string) => {
    if (!root || busyRef.current) return null;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const document = await createOwnedNote(root, owner, title);
      if (!context.current.live || context.current.root !== root) return null;
      const next = { owner, note_id: document.note_id };
      setExtra((items) => [...items, { target: next, title: document.title, ownerTitle: owner.kind === 'entry' ? entries.find((entry) => entry.id === owner.entry_id)?.title ?? '文档笔记' : `标签综合笔记 · ${tagTitle}` }]);
      reload();
      if (owner.kind === 'entry') void Promise.resolve(onRefreshEntries()).catch(() => setError('笔记已创建，条目列表刷新失败；可从当前列表打开，请勿重复创建。'));
      return next;
    } catch (caught) { setError(String(caught)); return null; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const setDeleted = async (option: ParallelNoteOption, deleted: boolean) => {
    if (!root || option.target.owner.kind !== 'tag_reading' || !option.revision || busyRef.current) return false;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      await setTagNoteDeleted(root, option.target.owner.tag_id, option.target.note_id, deleted, option.revision);
      reload(); return true;
    } catch (caught) { setError(String(caught)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  return { ...owned, options, selected: options.find((item) => sameNoteTarget(item.target, target)), loading: catalog?.loading ?? loading,
    error: error ?? catalog?.error ?? null, busy, reload, create, setDeleted };
}
