import { invoke } from '@tauri-apps/api/core';
import type { EntryMeta } from '@/shared/types/domain';

export type PdfParseQueue = { waiting: EntryMeta[]; active: EntryMeta[]; failed: EntryMeta[] };
export type ParseQueueMove = 'first' | 'up' | 'down' | 'remove';
export const readPdfParseQueue = (root: string) => invoke<PdfParseQueue>('read_pdf_parse_queue', { request: { root } });
export const movePdfParseQueue = (root: string, entryId: string, movement: ParseQueueMove) =>
  invoke<PdfParseQueue>('move_pdf_parse_queue', { request: { root, entry_id: entryId, movement } });
export const processPdfParseQueue = (root: string, endpoint: string, apiKey?: string) =>
  invoke<void>('process_pdf_parse_queue', { request: { root, endpoint, api_key: apiKey || null } });
