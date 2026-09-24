// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';
import { EntryPdfActions } from './EntryPdfActions';
import type { LibraryEntry } from './LibrarySidebar';
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const entry: LibraryEntry = { id: 'pdf-entry', title: '旧论文', tags: [], tagIds: [], fields: {}, contents: [], pdfFileName: 'old.pdf', status: 'Parsed', progress: 100, createdAt: '', updatedAt: '', parseMessage: null, parseEndpoint: null };

it('creates a version for an existing PDF instead of attaching over the original', async () => {
  vi.mocked(open).mockResolvedValue('C:/papers/new.pdf');
  const onCreatePdfVersion = vi.fn(), onAttachPdf = vi.fn();
  const view = render(<EntryPdfActions entry={entry} onCreatePdfVersion={onCreatePdfVersion} onAttachPdf={onAttachPdf} />);
  fireEvent.click(view.getByRole('button', { name: '创建新版 PDF' }));
  await waitFor(() => expect(onCreatePdfVersion).toHaveBeenCalledWith(entry.id, 'C:/papers/new.pdf'));
  expect(onAttachPdf).not.toHaveBeenCalled(); expect(entry.pdfFileName).toBe('old.pdf');
});
it('cancels without writing, then uploads to an entry without a PDF', async () => {
  vi.mocked(open).mockResolvedValueOnce(null).mockResolvedValueOnce('C:/papers/first.pdf');
  const onAttachPdf = vi.fn(); const view = render(<EntryPdfActions entry={{ ...entry, pdfFileName: null }} onAttachPdf={onAttachPdf} />);
  const button = view.getByRole('button', { name: '上传 PDF' }) as HTMLButtonElement;
  fireEvent.click(button); await waitFor(() => expect(button.disabled).toBe(false)); expect(onAttachPdf).not.toHaveBeenCalled();
  fireEvent.click(button); await waitFor(() => expect(onAttachPdf).toHaveBeenCalledWith(entry.id, 'C:/papers/first.pdf'));
});
it('shows a picker failure and allows retry', async () => {
  vi.mocked(open).mockRejectedValueOnce(new Error('文件选择失败')).mockResolvedValueOnce('C:/result.zip');
  const onImportMineruClientResult = vi.fn(); const view = render(<EntryPdfActions entry={entry} onImportMineruClientResult={onImportMineruClientResult} />);
  fireEvent.click(view.getByRole('button', { name: '导入客户端解析结果' }));
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('文件选择失败'));
  fireEvent.click(view.getByRole('button', { name: '导入客户端解析结果' }));
  await waitFor(() => expect(onImportMineruClientResult).toHaveBeenCalledWith(entry.id, 'C:/result.zip'));
});
