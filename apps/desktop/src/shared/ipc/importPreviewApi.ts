import { invoke } from '@tauri-apps/api/core';

export type ImportPreviewRequest = { root: string; snapshot_id: string } & (
  | { source: 'mineru'; item_id: string }
  | { source: 'zotero'; paper_id: string; attachment_key: string }
);

export async function readImportPreview(request: ImportPreviewRequest): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>('read_import_preview', { request }));
}
