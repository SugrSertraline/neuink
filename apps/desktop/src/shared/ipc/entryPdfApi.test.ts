import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { fetchEntryPdf } from './entryPdfApi';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../lib/localBackgroundJobs', () => ({ runLocalBackgroundJob: (_options: unknown, execute: () => Promise<unknown>) => execute() }));
beforeEach(() => vi.clearAllMocks());

it('shares the same in-flight entry request and releases failures for retry', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValueOnce({ status: 'saved', entry: { id: 'entry', pdf: {} } });
  const first = fetchEntryPdf('workspace', 'entry', 'Paper');
  expect(fetchEntryPdf('workspace', 'entry', 'Paper')).toBe(first);
  expect(invoke).toHaveBeenCalledTimes(1);
  reject(new Error('no PDF'));
  await expect(first).rejects.toThrow('no PDF');
  await fetchEntryPdf('workspace', 'entry', 'Paper');
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenLastCalledWith('fetch_entry_pdf', { request: { root: 'workspace', entry_id: 'entry', confirmed_duplicate_hash: undefined } });
});

it('reviews a duplicate download and retries only with the confirmed content hash', async () => {
  const duplicate = { entryId: 'existing', title: 'Original paper', fileName: 'original.pdf', contentHash: 'same-hash', inTrash: false };
  vi.mocked(invoke).mockResolvedValueOnce({ status: 'duplicate', duplicate, source: 'https://example.org/paper.pdf' })
    .mockResolvedValueOnce({ status: 'saved', entry: { id: 'entry', pdf: {} } });
  const confirm = vi.fn().mockResolvedValue(true);
  await fetchEntryPdf('workspace', 'entry', 'New paper', confirm);
  expect(confirm).toHaveBeenCalledWith({ candidateTitle: 'New paper', sourcePath: 'https://example.org/paper.pdf', duplicate });
  expect(invoke).toHaveBeenLastCalledWith('fetch_entry_pdf', { request: { root: 'workspace', entry_id: 'entry', confirmed_duplicate_hash: 'same-hash' } });
});

it('leaves a duplicate download unsaved when cancelled', async () => {
  const duplicate = { entryId: 'existing', title: 'Original paper', fileName: 'original.pdf', contentHash: 'same-hash', inTrash: false };
  vi.mocked(invoke).mockResolvedValueOnce({ status: 'duplicate', duplicate, source: 'online.pdf' });
  await expect(fetchEntryPdf('workspace', 'entry', 'New paper', vi.fn().mockResolvedValue(false))).rejects.toThrow('已取消添加重复的 PDF');
  expect(invoke).toHaveBeenCalledTimes(1);
});
