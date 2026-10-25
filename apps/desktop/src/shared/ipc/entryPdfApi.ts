import { invoke } from '@tauri-apps/api/core';
import type { EntryMeta } from '../types/domain';
import { runLocalBackgroundJob } from '../lib/localBackgroundJobs';

const activeRequests = new Map<string, Promise<EntryMeta>>();

export function fetchEntryPdf(root: string, entryId: string, title: string): Promise<EntryMeta> {
  const key = JSON.stringify([root, entryId]);
  const active = activeRequests.get(key);
  if (active) return active;
  const request = runLocalBackgroundJob({
    kind: 'pdf_import', scope: { kind: 'workspace', root }, idPrefix: 'fetch-entry-pdf',
    message: `正在获取 PDF：${title}`,
    successMessage: `PDF 已保存：${title}`,
    failureMessage: `未获取到 PDF：${title}`
  }, () => invoke<EntryMeta>('fetch_entry_pdf', { request: { root, entry_id: entryId } }))
    .finally(() => activeRequests.delete(key));
  activeRequests.set(key, request);
  return request;
}
