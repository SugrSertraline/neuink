// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { LibrarySourceReviewDialog } from './LibrarySourceReviewDialog';
import type { LibrarySourceSync } from './useLibrarySourceSync';

afterEach(cleanup);

it('shows a changed source beside the local entry and applies only the chosen field', async () => {
  const entry: LibraryEntry = { id: 'local-1', title: '本地标题', fields: { year: '2024' }, tags: ['本地标签'], tagIds: [],
    contents: [], createdAt: '', updatedAt: '', pdfFileName: 'local.pdf', parseMessage: null, parseEndpoint: null, status: 'Parsed', progress: 100 };
  const sync: LibrarySourceSync = { root: 'workspace', running: false, current: '', completed: 0, total: 0, imported: 0, unresolved: 0,
    changedEntryIds: ['local-1'], changes: [{ source: 'zotero', entryId: 'local-1', sourceId: '1:ABC12345', fingerprint: 'version-1', sourceTitle: '来源标题', sourceFields: { year: '2025' }, sourceTags: ['来源标签'], sourcePdfName: 'source.pdf' }],
    issues: [], scanVersion: 1, truncated: false, error: null, refresh: vi.fn(), acknowledge: vi.fn() };
  const onApplyField = vi.fn(async () => undefined);
  render(<LibrarySourceReviewDialog open onOpenChange={vi.fn()} sync={sync} entries={[entry]} onOpenEntry={vi.fn()}
    onApplyTitle={vi.fn()} onApplyField={onApplyField} onApplyPdfName={vi.fn()} />);
  expect(screen.getByText(/标题：来源“来源标题”/)).toBeTruthy();
  expect(screen.getByText(/PDF 名称：来源“source.pdf”/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '追加来源标签' })).toBeNull();
  expect(screen.getByText(/不与本地标签比较或合并/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '采用' }));
  await waitFor(() => expect(onApplyField).toHaveBeenCalledExactlyOnceWith('local-1', 'year', '2025'));
  fireEvent.click(screen.getByRole('button', { name: '已核对' }));
  expect(sync.acknowledge).toHaveBeenCalledWith(sync.changes[0]);
});
