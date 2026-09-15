import { invoke } from '@tauri-apps/api/core';
import type { NoteTarget, SourceLink, TagMeta } from '@/shared/types/domain';

export type CatalogNote = { target: NoteTarget; title: string; owner_title: string; updated_at: string;
  deleted_at: string | null; revision: string; links: SourceLink[]; source_statuses?: SourceAvailability[]; error: string | null };
export type NoteCatalog = { notes: CatalogNote[]; errors: string[] };
export type SourceAvailability = { entry_id: string; segment_uid: string; quote_hash: string;
  status: 'available' | 'entry_trashed' | 'entry_deleted' | 'segment_missing' | 'content_changed' | 'unavailable'; message: string; can_locate: boolean };
export const NOTES_CHANGED = 'neuink:notes-changed';
export const notifyNotesChanged = (root: string) => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOTES_CHANGED, { detail: root })); };
export async function noteMutation<T>(root: string, operation: Promise<T>): Promise<T> {
  const result = await operation; notifyNotesChanged(root); return result;
}
export const readNoteCatalog = (root: string) => invoke<NoteCatalog>('read_note_catalog', { request: { root } });
export const inspectNoteSources = (root: string, sources: SourceLink['sources']) =>
  invoke<SourceAvailability[]>('inspect_note_sources', { request: { root, sources } });
export const updateTagDescription = (root: string, tagId: string, description: string, expected: string) =>
  invoke<TagMeta>('update_tag_description', { request: { root, tag_id: tagId, description, expected_description: expected } });
