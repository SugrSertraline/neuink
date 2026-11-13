import { runLocalBackgroundJob } from '../lib/localBackgroundJobs';
import { invoke } from '@tauri-apps/api/core';

export type ReadingExportKind = 'note' | 'segment_note' | 'annotation' | 'translation';
export type ReadingExportFormat = 'docx' | 'txt' | 'txt_zip' | 'docx_zip';
export type ReadingExportScope = { kinds?: ReadingExportKind[]; item_ids?: string[]; segment_uids?: string[] };
export type ReadingExportItem = {
  id: string;
  kind: ReadingExportKind;
  title: string;
  page: number | null;
  note_id: string | null;
  preview: string;
  fingerprint: string;
  warnings: string[];
};
export type ReadingExportCatalog = { entry_title: string; items: ReadingExportItem[]; scope_applied?: boolean };

export function inspectReadingExport(root: string, entryId: string, noteId?: string, scope?: ReadingExportScope) {
  return invoke<ReadingExportCatalog>('inspect_reading_export', { request: { root, entry_id: entryId, note_id: noteId ?? null, scope: scope ?? {} } });
}

export function exportReading(request: {
  root: string;
  entry_id: string;
  selected: { id: string; fingerprint: string }[];
  format: ReadingExportFormat;
  target_path: string;
  allow_incomplete: boolean;
}) {
  return runLocalBackgroundJob({ kind: 'export', scope: { kind: 'entry', root: request.root, entry_id: request.entry_id },
    message: '正在导出阅读成果', successMessage: '导出阅读成果完成', failureMessage: '导出阅读成果失败，请返回导出窗口重试',
  }, () => invoke<void>('export_reading', { request }));
}
