import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { TagMeta } from '@/shared/types/domain';

export type ZoteroSettings = { data_directory: string | null; linked_attachment_directory: string | null };
export type ZoteroAttachment = { key: string; file_name: string; available: boolean; reason: string | null };
export type ZoteroPaper = {
  id: string; key: string; library_id: number; library_name: string; title: string; authors: string; year: string;
  fields: Record<string, string>; tags: string[]; collection_ids: string[]; attachments: ZoteroAttachment[];
};
export type ZoteroSnapshot = {
  snapshot_id: string;
  library: { source_id: string; data_directory: string; collections: { id: string; name: string; path: string; parent_id: string | null }[]; papers: ZoteroPaper[] };
  existing: Record<string, string>;
};
export type ZoteroImportResult = { entry_id: string; title: string; status: 'imported' | 'skipped'; has_pdf: boolean };
export const getZoteroSettings = () => invoke<ZoteroSettings>('zotero', { request: { action: 'settings' } });
export const saveZoteroSettings = (settings: ZoteroSettings) => invoke<ZoteroSettings>('zotero', { request: { action: 'save_settings', ...settings } });
export const discoverZotero = () => invoke<ZoteroSettings[]>('zotero', { request: { action: 'discover' } });
export const scanZotero = (root: string) => invoke<ZoteroSnapshot>('zotero', { request: { action: 'scan', root } });
export const importZoteroPaper = (root: string, snapshot_id: string, paper_id: string, attachment_key: string | null) =>
  invoke<ZoteroImportResult>('zotero', { request: { action: 'import', root, snapshot_id, paper_id, attachment_key } });
export const zoteroCatalogTags = (root: string) => invoke<TagMeta[]>('zotero', { request: { action: 'catalog_tags', root } });

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
