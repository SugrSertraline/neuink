import { invoke } from '@tauri-apps/api/core';

export type PdfTextPage = { page_idx: number; text: string; truncated: boolean };
export type PdfTextInfo = { entry_id: string; entry_title: string; revision: string; page_count: number | null; pages: PdfTextPage[] };
export function inspectPdfText(root: string, entryId: string, startPage: number, pageCount: number) {
  return invoke<PdfTextInfo>('inspect_pdf_text', { request: { root, entry_id: entryId, start_page: startPage, page_count: pageCount } });
}
export async function readAssistantPdfBytes(root: string, entryId: string, revision: string) {
  const bytes = await invoke<ArrayBuffer | number[]>('read_assistant_pdf_bytes', { request: { root, entry_id: entryId, revision } });
  return new Uint8Array(bytes);
}
export function cachePdfText(root: string, info: PdfTextInfo, pageCount: number, pages: PdfTextPage[]) {
  return invoke<void>('cache_pdf_text', { request: { root, entry_id: info.entry_id, revision: info.revision, page_count: pageCount, pages } });
}
