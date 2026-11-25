// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryMeta } from '../types/domain';
import { useWorkspaceResourceActions } from './useWorkspaceResourceActions';

const api = vi.hoisted(() => ({
  replaceEntryReadingPdf: vi.fn(),
  verifyEntryReadingPdfReplacement: vi.fn(),
  verifyMineruZipReadingPdf: vi.fn(),
  checkMineruZipReadingPdf: vi.fn(),
  checkPdfDuplicate: vi.fn(),
  createFromMineruClientResult: vi.fn()
}));
vi.mock('../ipc/workspaceApi', async (original) => ({
  ...(await original<typeof import('../ipc/workspaceApi')>()),
  replaceEntryReadingPdf: api.replaceEntryReadingPdf,
  checkMineruZipReadingPdf: api.checkMineruZipReadingPdf,
  checkPdfDuplicate: api.checkPdfDuplicate,
  createFromMineruClientResult: api.createFromMineruClientResult
}));
vi.mock('@/shared/pdf/readingPdfVerification', () => ({
  verifyEntryReadingPdfReplacement: api.verifyEntryReadingPdfReplacement,
  verifyMineruZipReadingPdf: api.verifyMineruZipReadingPdf
}));
vi.mock('../ipc/tagReadingApi', () => ({ listTagArchives: async () => [], restoreTagArchive: vi.fn() }));
vi.mock('../ipc/noteCatalogApi', () => ({ updateTagDescription: vi.fn() }));

const entryWithHash = (hash: string): EntryMeta =>
  ({
    id: 'entry-1',
    title: 'A paper',
    tags: [],
    contents: [],
    fields: {},
    pdf: { file_name: 'paper.pdf', content_hash: hash, parse: { status: 'succeeded' } }
  }) as unknown as EntryMeta;

function setup(entries: EntryMeta[]) {
  const deps = {
    refreshAnnotationCatalog: vi.fn(),
    refreshEntries: vi.fn(async () => {}),
    refreshTrashItems: vi.fn(),
    root: 'D:/library',
    selectFirstEntry: vi.fn(),
    selectedEntryId: 'entry-1',
    setEntries: vi.fn(),
    setError: vi.fn(),
    setParseSubmissionCount: vi.fn(),
    setSelectedEntryId: vi.fn(),
    setTags: vi.fn(),
    setTrashedEntries: vi.fn(),
    tags: []
  };
  const hook = renderHook(
    (props: { entries: EntryMeta[] }) =>
      useWorkspaceResourceActions({ ...deps, entries: props.entries }),
    { initialProps: { entries } }
  );
  return { ...hook, deps };
}

beforeEach(() => {
  vi.resetAllMocks();
  api.verifyEntryReadingPdfReplacement.mockResolvedValue({ candidate: {}, origin: {} });
});
afterEach(cleanup);

it('checks duplicates against the original PDF before combined MinerU import', async () => {
  const summary = { candidate: {}, origin: {} };
  api.checkPdfDuplicate.mockResolvedValue(null);
  api.verifyMineruZipReadingPdf.mockResolvedValue(summary);
  api.createFromMineruClientResult.mockResolvedValue({ entry: entryWithHash('original-hash'), segment_count: 1 });
  const { result } = setup([]);
  await act(async () => {
    await result.current.createLibraryEntry({ title: 'A paper', mineruZipPath: 'result.zip', pdfPath: 'original.pdf' }, '');
  });
  expect(api.checkPdfDuplicate).toHaveBeenCalledWith('D:/library', 'original.pdf', 'pdf');
  expect(api.checkMineruZipReadingPdf).toHaveBeenCalledWith('result.zip', 'original.pdf', summary);
  expect(api.createFromMineruClientResult).toHaveBeenCalledWith(
    'D:/library', 'A paper', {}, [], 'result.zip', 'original.pdf', summary, undefined
  );
});

describe('replaceReadingPdfForEntry failure handling', () => {
  it('reports the error and reloads entries when the replace command fails', async () => {
    api.replaceEntryReadingPdf.mockRejectedValue(new Error('阅读 PDF 已变化，请刷新后重试。'));
    const { result, deps } = setup([entryWithHash('old-hash')]);

    await act(async () => {
      await expect(result.current.replaceReadingPdfForEntry('entry-1', 'D:/new.pdf')).rejects.toThrow();
    });

    expect(deps.setError).toHaveBeenCalledWith('阅读 PDF 已变化，请刷新后重试。');
    expect(deps.refreshEntries).toHaveBeenCalledWith('D:/library');
    expect(deps.setEntries).not.toHaveBeenCalled();
  });

  it('reports the error and reloads entries when verification fails before any write', async () => {
    api.verifyEntryReadingPdfReplacement.mockRejectedValue(new Error('页数不一致'));
    const { result, deps } = setup([entryWithHash('old-hash')]);

    await act(async () => {
      await expect(result.current.replaceReadingPdfForEntry('entry-1', 'D:/new.pdf')).rejects.toThrow('页数不一致');
    });

    expect(api.replaceEntryReadingPdf).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith('页数不一致');
    expect(deps.refreshEntries).toHaveBeenCalledWith('D:/library');
  });

  it('retries against the content_hash that the reload brought in', async () => {
    api.replaceEntryReadingPdf
      .mockRejectedValueOnce(new Error('阅读 PDF 已变化，请刷新后重试。'))
      .mockResolvedValueOnce(entryWithHash('new-hash'));
    const { result, rerender, deps } = setup([entryWithHash('old-hash')]);

    await act(async () => {
      await expect(result.current.replaceReadingPdfForEntry('entry-1', 'D:/new.pdf')).rejects.toThrow();
    });

    // A concurrent edit changed the hash. The reload makes the new hash visible to the hook.
    rerender({ entries: [entryWithHash('concurrent-hash')] });
    expect(deps.refreshEntries).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.replaceReadingPdfForEntry('entry-1', 'D:/new.pdf');
    });

    expect(api.replaceEntryReadingPdf).toHaveBeenLastCalledWith(
      'D:/library', 'entry-1', 'D:/new.pdf', 'concurrent-hash', expect.anything()
    );
    expect(deps.setError).toHaveBeenLastCalledWith(null);
  });
});
