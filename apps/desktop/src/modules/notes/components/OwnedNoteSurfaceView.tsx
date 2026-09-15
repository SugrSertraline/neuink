import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { noteOwnerKey, noteTargetKey, sameNoteTarget } from '@/shared/lib/noteOwner';
import type { NoteTarget, TagMeta } from '@/shared/types/domain';
import type { ReadingNoteBinding } from '@/modules/reader/parallel-reading/ReadingSessionContext';
import type { SourceLinkOpenTarget } from '../editor/SourceLinkNode';
import { MarkdownNoteEditor } from './MarkdownNoteEditor';
import { useOwnedNote, type EntryNoteSave } from '../useOwnedNote';
import { useWorkspaceNotes } from '../WorkspaceNotesContext';

export function OwnedNoteSurfaceView({ root, target, tags, label, onSource, onBinding, onSaveEntryNote, onOwner }: {
  root: string | null; target: NoteTarget; tags: TagMeta[]; label?: string; onSource: (source: SourceLinkOpenTarget) => void;
  onBinding: (key: string, binding: ReadingNoteBinding | null) => void; onSaveEntryNote: EntryNoteSave; onOwner: () => void;
}) {
  const catalog = useWorkspaceNotes();
  const info = catalog?.catalog.notes.find((note) => sameNoteTarget(note.target, target));
  const notes = useOwnedNote(root, target, onSaveEntryNote);
  const key = noteTargetKey(target);
  const callback = useRef(onBinding); callback.current = onBinding;
  const available = !info?.deleted_at && (target.owner.kind === 'entry' || tags.some((tag) => target.owner.kind === 'tag_reading' && tag.id === target.owner.tag_id));
  useEffect(() => {
    callback.current(key, available && notes.writable ? { title: info?.title ?? label ?? '标签笔记', onAddSource: notes.addSource } : null);
    return () => callback.current(key, null);
  }, [key, available, notes.writable, notes.addSource, info?.title, label]);
  if (!available) return <div className="space-y-2 p-4 text-sm"><p>{info?.deleted_at ? '这篇标签笔记已删除，可从标签的“已删除笔记”恢复。' : '所属标签已移入回收站，恢复标签后可继续编辑。'}</p><Button size="sm" variant="outline" onClick={onOwner}>返回标签</Button></div>;
  return <div className="flex h-full min-h-0 flex-col overflow-hidden">
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b px-2 py-1 text-xs"><span className="min-w-0 flex-1 truncate">{info?.owner_title ?? '标签'} · 标签笔记</span><Button size="xs" variant="ghost" onClick={onOwner}>返回标签</Button></div>
    <div className="min-h-0 flex-1 overflow-hidden"><MarkdownNoteEditor key={`${root}:${key}`} entryId={noteOwnerKey(target.owner)} noteOwner={target.owner}
      noteId={target.note_id} fallbackTitle={info?.title ?? label ?? '标签笔记'} entryTitle={info?.owner_title} workspaceRoot={root}
      editorScopeKey={`note:${key}`} onLoadNote={notes.load} onSaveNote={notes.save} onWritableChange={notes.setWritable}
      sourceLinkToInsert={notes.pending} onSourceLinkInserted={notes.inserted} onCreateSourceLinkFromPaste={notes.buildSource} onOpenSourceLink={onSource} /></div>
  </div>;
}
