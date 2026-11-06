// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkPdfDuplicate, createEntry, queuePdfParse } from '@/shared/ipc/workspaceApi';
import type { EntryMeta } from '@/shared/types/domain';
import { PdfDuplicateCancelledError } from '../lib/pdfDuplicate';
import { useWorkspaceResourceActions } from './useWorkspaceResourceActions';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  checkPdfDuplicate: vi.fn(), createEntry: vi.fn(), queuePdfParse: vi.fn()
}));
vi.mock('../lib/parserSettings', () => ({ readAutoParseOnPdfImport: () => false }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const duplicate = { entryId: 'existing', title: '已有论文', fileName: 'old.pdf', contentHash: 'same-hash', inTrash: false };
const entry = { id: 'new', title: '新论文', tags: [], fields: {}, pdf: null, contents: [], created_at: '', updated_at: '' } as EntryMeta;

function setup(confirmPdfDuplicate: (review: { duplicate: typeof duplicate; candidateTitle: string; sourcePath: string }) => Promise<boolean>) {
  return renderHook(() => useWorkspaceResourceActions({
    confirmPdfDuplicate, entries: [], root: 'library', tags: [], selectedEntryId: null,
    refreshAnnotationCatalog: vi.fn().mockResolvedValue([]), refreshEntries: vi.fn().mockResolvedValue(undefined),
    refreshTrashItems: vi.fn().mockResolvedValue([]), selectFirstEntry: vi.fn(),
    setEntries: vi.fn(), setError: vi.fn(), setParseSubmissionCount: vi.fn(),
    setSelectedEntryId: vi.fn(), setTags: vi.fn(), setTrashedEntries: vi.fn()
  }));
}

it('does not create an empty entry when the user cancels a duplicate', async () => {
  vi.mocked(checkPdfDuplicate).mockResolvedValue(duplicate);
  const confirm = vi.fn().mockResolvedValue(false);
  const view = setup(confirm);
  await expect(view.result.current.createLibraryEntry({ title: '新论文', pdfPath: 'renamed.pdf' }, '', ''))
    .rejects.toBeInstanceOf(PdfDuplicateCancelledError);
  expect(confirm).toHaveBeenCalledWith({ candidateTitle: '新论文', sourcePath: 'renamed.pdf', duplicate });
  expect(createEntry).not.toHaveBeenCalled();
});

it('passes the reviewed content hash to the native write only after consent', async () => {
  vi.mocked(checkPdfDuplicate).mockResolvedValue(duplicate);
  vi.mocked(createEntry).mockResolvedValue(entry);
  vi.mocked(queuePdfParse).mockResolvedValue({ ...entry, pdf: { file_name: 'renamed.pdf', content_hash: 'same-hash', imported_at: '', parse: { status: 'not_started', updated_at: '', message: null, task_id: null, endpoint: null } } });
  const view = setup(vi.fn().mockResolvedValue(true));
  const result = await view.result.current.createLibraryEntry({ title: '新论文', pdfPath: 'renamed.pdf' }, '', '');
  expect(result?.createdWithPdf).toBe(true);
  expect(queuePdfParse).toHaveBeenCalledWith('library', 'new', 'renamed.pdf', false, 'same-hash');
});
