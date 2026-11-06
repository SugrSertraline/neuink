import { beforeEach, expect, it, vi } from 'vitest';
import { checkPdfDuplicate } from '@/shared/ipc/workspaceApi';
import { DuplicatePdfError, ensurePdfIsNew } from './pdfDuplicate';

vi.mock('@/shared/ipc/workspaceApi', () => ({ checkPdfDuplicate: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('uses the PDF contents check and reports the existing title', async () => {
  vi.mocked(checkPdfDuplicate).mockResolvedValueOnce({ entryId: 'one', title: '原论文', fileName: 'paper.pdf', contentHash: 'hash-one', inTrash: false });
  await expect(ensurePdfIsNew('library', 'renamed.pdf', 'pdf'))
    .rejects.toMatchObject({ name: 'DuplicatePdfError', duplicate: { entryId: 'one' } });
  expect(checkPdfDuplicate).toHaveBeenCalledWith('library', 'renamed.pdf', 'pdf');
  expect(new DuplicatePdfError({ entryId: 'one', title: '原论文', fileName: 'paper.pdf', contentHash: 'hash-one', inTrash: true }).message).toContain('回收站');
});

it('allows a new PDF and checks MinerU sources', async () => {
  vi.mocked(checkPdfDuplicate).mockResolvedValue(null);
  await expect(ensurePdfIsNew('library', 'result.zip', 'mineru')).resolves.toBeUndefined();
  expect(checkPdfDuplicate).toHaveBeenCalledWith('library', 'result.zip', 'mineru');
});
