import { invoke } from '@tauri-apps/api/core';
import type { NoteDocument, NoteOwner, NoteTarget, SourceLink } from '@/shared/types/domain';
import { createNote, createNoteSourceLink, importNoteAsset, openNoteFile, readNote, revealNoteFile, saveNoteAssetBytes, updateNote } from './workspaceApi';
import type { ReadingExportCatalog, ReadingExportFormat } from './readingExportApi';
import { noteMutation, notifyNotesChanged } from './noteCatalogApi';

export type TagNoteSummary = { note_id: string; title: string; updated_at: string; deleted_at: string | null; revision: string };
type Asset = { markdown_path: string; file_path: string };
function tagNote<T>(root: string, tagId: string, action: Record<string, unknown>) {
  return invoke<T>('tag_note', { request: { root, tag_id: tagId, action } });
}
export const listTagNotes = (root: string, tagId: string) => tagNote<TagNoteSummary[]>(root, tagId, { kind: 'list' });
export const readOwnedNote = (root: string, target: NoteTarget) => target.owner.kind === 'entry'
  ? readNote(root, target.owner.entry_id, target.note_id)
  : tagNote<NoteDocument>(root, target.owner.tag_id, { kind: 'read', note_id: target.note_id });
export async function createOwnedNote(root: string, owner: NoteOwner, title: string): Promise<NoteDocument> {
  if (owner.kind === 'tag_reading') return noteMutation(root, tagNote(root, owner.tag_id, { kind: 'create', title }));
  const entry = await createNote(root, owner.entry_id, title);
  notifyNotesChanged(root);
  const note = [...entry.contents].reverse().find((content) => content.kind === 'note');
  if (!note) throw new Error('笔记创建后未返回标识，请刷新列表确认，避免重复创建。');
  return readNote(root, owner.entry_id, note.note_id);
}
export const saveOwnedNote = (root: string, target: NoteTarget, document: NoteDocument) => noteMutation(root, target.owner.kind === 'entry'
  ? updateNote(root, target.owner.entry_id, target.note_id, document.title, document.markdown, document.links, document.revision)
  : tagNote<NoteDocument>(root, target.owner.tag_id, { kind: 'save', document }));
export const setTagNoteDeleted = (root: string, tagId: string, noteId: string, deleted: boolean, revision: string) =>
  noteMutation(root, tagNote<void>(root, tagId, { kind: 'set_deleted', note_id: noteId, deleted, expected_revision: revision }));
export const buildOwnedNoteSourceLink = (root: string, target: NoteTarget, sourceEntryId: string, segmentUid: string) => target.owner.kind === 'entry'
  ? createNoteSourceLink(root, target.owner.entry_id, target.note_id, sourceEntryId, segmentUid)
  : tagNote<SourceLink>(root, target.owner.tag_id, { kind: 'build_source_link', note_id: target.note_id, source_entry_id: sourceEntryId, segment_uid: segmentUid });
export const importOwnedNoteAsset = (root: string, owner: NoteOwner, noteId: string, path: string) => owner.kind === 'entry'
  ? importNoteAsset(root, owner.entry_id, noteId, path)
  : tagNote<Asset>(root, owner.tag_id, { kind: 'import_asset', note_id: noteId, source_path: path });
export const saveOwnedNoteAssetBytes = (root: string, owner: NoteOwner, noteId: string, mime: string, base64: string, fileName?: string | null) => owner.kind === 'entry'
  ? saveNoteAssetBytes(root, owner.entry_id, noteId, mime, base64, fileName)
  : tagNote<Asset>(root, owner.tag_id, { kind: 'save_asset', note_id: noteId, mime_type: mime, data_base64: base64 });
export const openOwnedNoteFile = (root: string, owner: NoteOwner, noteId: string, reveal: boolean) => owner.kind === 'entry'
  ? (reveal ? revealNoteFile : openNoteFile)(root, owner.entry_id, noteId)
  : tagNote<void>(root, owner.tag_id, { kind: 'file', note_id: noteId, reveal });
export const inspectTagNoteExport = (root: string, tagId: string, noteId?: string) =>
  tagNote<ReadingExportCatalog>(root, tagId, { kind: 'inspect_export', note_id: noteId ?? null });
export const exportTagNotes = (root: string, tagId: string, options: { selected: { id: string; fingerprint: string }[]; format: ReadingExportFormat; target_path: string; allow_incomplete: boolean }) =>
  tagNote<void>(root, tagId, { kind: 'export', ...options });
