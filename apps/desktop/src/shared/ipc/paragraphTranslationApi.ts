import { invoke } from '@tauri-apps/api/core';

export type ParagraphView = 'paragraph' | 'sentences';
export type TranslationTiming = { queued_ms: number; rate_limit_ms: number; generation_ms: number; total_ms: number };
export type TranslationPart<T> = { status: 'running' | 'succeeded' | 'failed'; value: T | null; error: string | null; timing?: TranslationTiming | null };
export type SentenceTranslation = { id: number; source: string; translation: string };
export type ParagraphTranslation = {
  segment_uid: string; source_text: string; source_hash: string; job_id: string; model: string; view: ParagraphView;
  paragraph: TranslationPart<string>; sentences: TranslationPart<SentenceTranslation[]>;
};
export type ParagraphLiveProgress = {
  root: string; entry_id: string; segment_uid: string; job_id: string; source_hash: string;
  part: ParagraphView; phase: 'queued' | 'rate_limited' | 'generating'; sequence: number;
  retry_after_ms: number | null; paragraph: string | null; sentences: SentenceTranslation[]; sources: string[];
  timing: TranslationTiming; receivedAt?: number;
};
export function readParagraphTranslations(root: string, entryId: string) {
  return invoke<Record<string, ParagraphTranslation>>('read_paragraph_translations', { request: { root, entry_id: entryId } });
}
export function translateParagraph(root: string, entryId: string, segmentUid: string, retryFailed = false) {
  return invoke<ParagraphTranslation>('translate_paragraph', { request: { root, entry_id: entryId, segment_uid: segmentUid, retry_failed: retryFailed } });
}
export function setParagraphTranslationView(root: string, entryId: string, segmentUid: string, view: ParagraphView) {
  return invoke<ParagraphTranslation>('set_paragraph_translation_view', { request: { root, entry_id: entryId, segment_uid: segmentUid, view } });
}
