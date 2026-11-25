// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImportPdfPreview } from './ImportPdfPreview';

const read = vi.hoisted(() => vi.fn());
vi.mock('@/shared/ipc/importPreviewApi', () => ({ readImportPreview: read }));
vi.mock('@/modules/reader/components/pdf-reader/usePdfDocument', () => ({
  usePdfDocument: (bytes: Uint8Array | null) => bytes ? { status: 'ready', document: { numPages: 2, marker: bytes[0] } } : { status: 'idle', document: null },
}));
vi.mock('@/modules/reader/components/pdf-reader/PdfCanvasPage', () => ({
  PdfCanvasPage: ({ pageIdx, pdfDocument }: { pageIdx: number; pdfDocument: { marker: number } }) => <p>PDF {pdfDocument.marker} page {pageIdx + 1}</p>,
}));
const request = { source: 'mineru' as const, root: 'workspace', snapshot_id: 'scan', item_id: 'first' };
beforeEach(() => {
  read.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('ignores a late PDF response after switching documents and supports page navigation', async () => {
  let finishFirst!: (bytes: Uint8Array) => void;
  read.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; })).mockResolvedValueOnce(new Uint8Array([2]));
  const view = render(<ImportPdfPreview request={request} title="First" onClose={() => {}} />);
  expect(screen.getByRole('status').textContent).toContain('正在读取');
  view.rerender(<ImportPdfPreview request={{ ...request, item_id: 'second' }} title="Second" onClose={() => {}} />);
  await screen.findByText('PDF 2 page 1');
  await act(async () => finishFirst(new Uint8Array([1])));
  expect(screen.queryByText('PDF 1 page 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.getByText('PDF 2 page 2')).toBeTruthy();
  expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows read errors and retries without needing an import', async () => {
  read.mockRejectedValueOnce('PDF 已移动').mockResolvedValueOnce(new Uint8Array([3]));
  render(<ImportPdfPreview request={request} title="Paper" onClose={() => {}} />);
  await screen.findByText('PDF 已移动');
  fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
  await screen.findByText('PDF 3 page 1');
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
});
