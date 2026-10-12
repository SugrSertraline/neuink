import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { fetchEntryPdf } from './entryPdfApi';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../lib/localBackgroundJobs', () => ({ runLocalBackgroundJob: (_options: unknown, execute: () => Promise<unknown>) => execute() }));
beforeEach(() => vi.clearAllMocks());

it('shares the same in-flight entry request and releases failures for retry', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(invoke).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValueOnce({ id: 'entry', pdf: {} });
  const first = fetchEntryPdf('workspace', 'entry', 'Paper');
  expect(fetchEntryPdf('workspace', 'entry', 'Paper')).toBe(first);
  expect(invoke).toHaveBeenCalledTimes(1);
  reject(new Error('no PDF'));
  await expect(first).rejects.toThrow('no PDF');
  await fetchEntryPdf('workspace', 'entry', 'Paper');
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenLastCalledWith('fetch_entry_pdf', { request: { root: 'workspace', entry_id: 'entry' } });
});
