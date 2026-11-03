import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type MineruSettings = { results_directory: string | null };
export type MineruCandidate = MineruSettings & { count: number; truncated: boolean };
export type MineruItem = { id: string; path: string; title: string; kind: 'directory' | 'zip' | 'rar'; has_pdf: boolean };
export type MineruSnapshot = { snapshot_id: string; source_directory: string; items: MineruItem[]; truncated: boolean };
export type MineruImportResult = { status: 'imported' | 'skipped'; entry_id: string; title: string };

export const getMineruSettings = () => invoke<MineruSettings>('mineru', { request: { action: 'settings' } });
export const saveMineruSettings = (settings: MineruSettings) => invoke<MineruSettings>('mineru', { request: { action: 'save_settings', ...settings } });
export const discoverMineru = (searchId: string) => invoke<MineruCandidate[]>('mineru', { request: { action: 'discover', search_id: searchId } });
export const cancelMineruSearch = (searchId: string) => invoke<void>('mineru', { request: { action: 'cancel_search', search_id: searchId } });
export const scanMineru = (root: string, searchId: string) => invoke<MineruSnapshot>('mineru', { request: { action: 'scan', root, search_id: searchId } });
export const importMineruItem = (root: string, snapshot_id: string, item_id: string) =>
  invoke<MineruImportResult>('mineru', { request: { action: 'import', root, snapshot_id, item_id } });

export function onMineruSettingsChanged(callback: () => void) {
  if (!('__TAURI_INTERNALS__' in window)) return () => undefined;
  let closed = false;
  let unlisten: (() => void) | undefined;
  void listen('mineru-settings-changed', () => { if (!closed) callback(); })
    .then(stop => { if (closed) stop(); else unlisten = stop; }).catch(() => undefined);
  return () => { closed = true; unlisten?.(); };
}
