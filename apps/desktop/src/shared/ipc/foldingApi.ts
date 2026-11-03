import { invoke } from '@tauri-apps/api/core';

export type FoldRecord = {
  segment_uid: string;
  source: string;
  evidence: number[];
  brief: string[];
  key: string;
  takeaway: string;
  topic: string;
  model: string;
  generated_at: string;
  translations?: Record<string, FoldTranslation>;
};

export type FoldTranslation = { source_text: string; translated_text: string; model: string; generated_at: string };

export function readEntryFolds(root: string, entryId: string) {
  return invoke<Record<string, FoldRecord>>('read_entry_folds', { request: { root, entry_id: entryId } });
}

export function upsertEntryFolds(root: string, entryId: string, records: FoldRecord[]) {
  return invoke<void>('upsert_entry_folds', { request: { root, entry_id: entryId, records } });
}

export function saveFoldTranslation(root: string, entryId: string, segmentUid: string, level: string, translation: FoldTranslation) {
  return invoke<void>('save_fold_translation', { request: { root, entry_id: entryId, segment_uid: segmentUid, level, translation } });
}
