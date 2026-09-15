import { createOwnedNote, readOwnedNote, setTagNoteDeleted } from '@/shared/ipc/noteOwnerApi';
import type { CatalogNote } from '@/shared/ipc/noteCatalogApi';
import { noteOwnerKey } from '@/shared/lib/noteOwner';
import type { NoteTarget } from '@/shared/types/domain';
import { hasUnsavedMarkdownNote, saveMarkdownNoteBeforeClose } from './editor/noteDirtyRegistry';
import { useWorkspaceNotes } from './WorkspaceNotesContext';
import { useNoteAction } from './useNoteAction';

// Sidebar, tag library and trash use the same revision and unsaved-draft checks.
export function useTagNoteActions(scope: string) {
  const model = useWorkspaceNotes();
  const action = useNoteAction(scope, model?.root ?? null);
  const writable = Boolean(model?.root && !model.loading && !model.error && !action.busy);
  const create = (tagId: string, title: string, onCreated: (target: NoteTarget, title: string) => void) => action.run(async isCurrent => {
    if (!writable || !model?.root || !tagId || !title.trim()) return;
    const owner = { kind: 'tag_reading' as const, tag_id: tagId };
    const document = await createOwnedNote(model.root, owner, title.trim());
    if (isCurrent()) onCreated({ owner, note_id: document.note_id }, document.title);
  });
  const setDeleted = (note: CatalogNote, deleted: boolean) => action.run(async isCurrent => {
    if (!writable || !model?.root || note.target.owner.kind !== 'tag_reading' || note.error) return;
    const owner = noteOwnerKey(note.target.owner);
    let revision = note.revision;
    if (hasUnsavedMarkdownNote(owner, note.target.note_id)) {
      if (!await saveMarkdownNoteBeforeClose(owner, note.target.note_id)) throw new Error('笔记仍有未保存内容，请返回编辑器处理后重试。');
      revision = (await readOwnedNote(model.root, note.target)).revision;
    }
    if (!isCurrent()) return;
    await setTagNoteDeleted(model.root, note.target.owner.tag_id, note.target.note_id, deleted, revision);
    model.refresh();
  });
  return { ...action, writable, create, setDeleted };
}
