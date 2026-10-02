// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';
import { EntryPdfActions } from './EntryPdfActions';
import type { LibraryEntry } from './LibrarySidebar';
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const entry: LibraryEntry = { id: 'pdf-entry', title: '旧论文', tags: [], tagIds: [], fields: {}, contents: [], pdfFileName: 'old.pdf', status: 'Parsed', progress: 100, createdAt: '', updatedAt: '', parseMessage: null, parseEndpoint: null };

it('requires confirmation for reparsing and preserves retry after failure', async () => {
  const onReparsePdf = vi.fn().mockRejectedValueOnce(new Error('队列不可用')).mockResolvedValueOnce(undefined);
  const view = render(<EntryPdfActions entry={entry} onReparsePdf={onReparsePdf} />);
  fireEvent.click(view.getByRole('button', { name: '重新解析 PDF' }));
  expect(onReparsePdf).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '取消' }));
  expect(onReparsePdf).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '重新解析 PDF' }));
  fireEvent.click(view.getByRole('button', { name: '确认重新解析' }));
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe('队列不可用'));
  expect(onReparsePdf).toHaveBeenCalledWith(entry.id);
  fireEvent.click(view.getByRole('button', { name: '确认重新解析' }));
  await waitFor(() => expect(view.queryByRole('dialog')).toBeNull());
  expect(onReparsePdf).toHaveBeenCalledTimes(2);
});

it('hides reparse when the entry has no parsed PDF', () => {
  const view = render(<EntryPdfActions entry={{ ...entry, status: 'Parsing' }} onReparsePdf={vi.fn()} />);
  expect(view.queryByRole('button', { name: '重新解析 PDF' })).toBeNull();
  view.rerender(<EntryPdfActions entry={{ ...entry, pdfFileName: null }} onReparsePdf={vi.fn()} />);
  expect(view.queryByRole('button', { name: '重新解析 PDF' })).toBeNull();
});

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
