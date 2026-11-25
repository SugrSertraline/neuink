import { invoke } from '@tauri-apps/api/core';
export type SavedSentenceTranslation = { segment_uid: string; paragraph_source: string; source: string; source_start: number; translation: string };
export function sentenceTranslation(root: string, entryId: string, record?: SavedSentenceTranslation, expected?: string) {
  return invoke<Record<string, SavedSentenceTranslation>>('sentence_translation', { request: { root, entry_id: entryId, record, expected } });
}
