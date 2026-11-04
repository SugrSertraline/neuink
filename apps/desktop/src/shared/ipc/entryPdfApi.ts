import { invoke } from '@tauri-apps/api/core';
import type { EntryMeta } from '../types/domain';
import { runLocalBackgroundJob } from '../lib/localBackgroundJobs';
import type { PdfDuplicate } from './workspaceApi';
import { DuplicatePdfError, PdfDuplicateCancelledError, type ConfirmPdfDuplicate } from '../lib/pdfDuplicate';

type FetchEntryPdfResult = { status: 'saved'; entry: EntryMeta } | { status: 'duplicate'; duplicate: PdfDuplicate; source: string };

const activeRequests = new Map<string, Promise<EntryMeta>>();

export function fetchEntryPdf(root: string, entryId: string, title: string, confirmPdfDuplicate?: ConfirmPdfDuplicate): Promise<EntryMeta> {
  const key = JSON.stringify([root, entryId]);
  const active = activeRequests.get(key);
  if (active) return active;
  const request = runLocalBackgroundJob({
    kind: 'pdf_import', scope: { kind: 'workspace', root }, idPrefix: 'fetch-entry-pdf',
    message: `正在获取 PDF：${title}`,
    successMessage: `PDF 已保存：${title}`,
    failureMessage: `未获取到 PDF：${title}`
  }, async () => {
    let confirmedHash: string | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await invoke<FetchEntryPdfResult>('fetch_entry_pdf', { request: { root, entry_id: entryId, confirmed_duplicate_hash: confirmedHash } });
      if (result.status === 'saved') return result.entry;
      if (!confirmPdfDuplicate) throw new DuplicatePdfError(result.duplicate);
      const confirmed = await confirmPdfDuplicate({ candidateTitle: title, sourcePath: result.source, duplicate: result.duplicate });
      if (!confirmed) throw new PdfDuplicateCancelledError(result.duplicate);
      confirmedHash = result.duplicate.contentHash;
    }
    throw new Error('在线 PDF 内容多次变化，请稍后重新获取。');
  })
    .finally(() => activeRequests.delete(key));
  activeRequests.set(key, request);
  return request;
}
