import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { TagMeta } from '@/shared/types/domain';
import type { PdfDuplicate } from '@/shared/ipc/workspaceApi';

export type ZoteroSettings = { enabled?: boolean; data_directory: string | null; linked_attachment_directory: string | null };
export type ZoteroAttachment = { key: string; file_name: string; available: boolean; reason: string | null };
export type ZoteroPaper = {
  id: string; key: string; library_id: number; library_name: string; title: string; authors: string; year: string;
  fields: Record<string, string>; tags: string[]; collection_ids: string[]; attachments: ZoteroAttachment[];
};
export type ZoteroSnapshot = {
  organization_updated?: boolean;
  snapshot_id: string;
  library: { source_id: string; data_directory: string; collections: { id: string; name: string; path: string; parent_id: string | null }[]; papers: ZoteroPaper[] };
  existing: Record<string, string>;
  hidden: string[];
  changed?: string[];
  fingerprints?: Record<string, string>;
};
export type ZoteroImportResult = { entry_id: string; title: string; status: 'imported' | 'skipped' | 'duplicate'; has_pdf: boolean; duplicate?: PdfDuplicate };
export const getZoteroSettings = () => invoke<ZoteroSettings>('zotero', { request: { action: 'settings' } });
export const setZoteroEnabled = (enabled: boolean) => invoke<ZoteroSettings>('zotero', { request: { action: 'set_enabled', enabled } });
export const saveZoteroSettings = (settings: ZoteroSettings) => invoke<ZoteroSettings>('zotero', { request: { action: 'save_settings', ...settings } });
export const discoverZotero = () => invoke<ZoteroSettings[]>('zotero', { request: { action: 'discover' } });
export const scanZotero = (root: string) => invoke<ZoteroSnapshot>('zotero', { request: { action: 'scan', root } });
export const setZoteroPaperHidden = (root: string, snapshot_id: string, paper_id: string, hidden: boolean) =>
  invoke<{ hidden: boolean }>('zotero', { request: { action: 'set_hidden', root, snapshot_id, paper_id, hidden } });
export const setImportedZoteroEntryHidden = (root: string, entry_id: string, hidden: boolean) =>
  invoke<{ hidden: boolean }>('zotero', { request: { action: 'set_entry_hidden', root, entry_id, hidden } });
export const importZoteroPaper = (root: string, snapshot_id: string, paper_id: string, attachment_key: string | null, confirmed_duplicate_hash?: string, catalog = false) =>
  invoke<ZoteroImportResult>('zotero', { request: { action: 'import', root, snapshot_id, paper_id, attachment_key, confirmed_duplicate_hash, catalog } });
export const zoteroCatalogTags = (root: string) => invoke<TagMeta[]>('zotero', { request: { action: 'catalog_tags', root } });
export type ZoteroNotePreview = { server_id: string; version: number; html: string };
export type ZoteroNoteOrigin = { note_key: string; local_modified?: boolean; source_html?: string | null };
export const getZoteroNoteOrigin = (root: string, entryId: string, noteId: string) =>
  invoke<ZoteroNoteOrigin | null>('zotero', { request: { action: 'note_origin', root, entry_id: entryId, note_id: noteId } });
export const previewZoteroNote = (root: string, entryId: string, noteId: string) =>
  invoke<ZoteroNotePreview>('zotero', { request: { action: 'preview_note', root, entry_id: entryId, note_id: noteId } });
export type SourceNoteCandidate = { key: string; content_hash: string; title: string; text: string; imported: boolean };
export const listZoteroNoteImports = (root: string, source_entry_id: string, target_entry_id: string) =>
  invoke<{ notes: SourceNoteCandidate[]; source_title: string }>('zotero', { request: { action: 'note_import_list', root, source_entry_id, target_entry_id } });
export const importZoteroLocalCopy = (root: string, source_entry_id: string, force_new = false) =>
  invoke<{ entry_id: string; created: boolean; used_cached_source?: boolean }>('zotero', { request: { action: 'import_local', root, source_entry_id, force_new } });
export const importZoteroNotes = (root: string, source_entry_id: string, target_entry_id: string, selected: { key: string; content_hash: string }[]) =>
  invoke<{ imported: number; skipped: number; entry_id: string }>('zotero', { request: { action: 'import_notes', root, source_entry_id, target_entry_id, selected } });
export const overwriteZoteroNote = (root: string, entryId: string, noteId: string, html: string, preview: ZoteroNotePreview) =>
  invoke<{ written: boolean; backup_path: string }>('zotero', { request: { action: 'overwrite_note', root, entry_id: entryId, note_id: noteId, html,
    expected_version: preview.version, expected_server_id: preview.server_id, confirmed: true } });

export function onZoteroSettingsChanged(callback: () => void) {
  if (!('__TAURI_INTERNALS__' in window)) return () => undefined;
  let closed = false;
  let unlisten: (() => void) | undefined;
  void listen('zotero-settings-changed', () => { if (!closed) callback(); })
    .then(stop => { if (closed) stop(); else unlisten = stop; }).catch(() => { /* The next explicit open reloads settings. */ });
  return () => { closed = true; unlisten?.(); };
}

export function onZoteroLibraryChanged(root: string, onChange: () => void, onError: (e: unknown) => void) {
  if (!('__TAURI_INTERNALS__' in window)) return () => undefined;
  let closed = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  void listen<{ root: string }>('zotero-library-changed', event => {
    if (closed || event.payload.root !== root) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!closed) onChange(); }, 120);
  }).then(stop => { if (closed) stop(); else unlisten = stop; }).catch(e => { if (!closed) onError(e); });
  return () => { closed = true; clearTimeout(timer); unlisten?.(); };
}
