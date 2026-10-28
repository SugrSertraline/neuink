// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import { PdfParseButton, type PdfParseAction } from './PdfParseButton';
import type { LibraryEntry } from './LibrarySidebar';

afterEach(cleanup);
const entry: LibraryEntry = { id: 'paper', title: 'Paper', contents: [], tagIds: [], tags: [], fields: {},
  createdAt: '', updatedAt: '', pdfFileName: 'paper.pdf', parseMessage: null, parseEndpoint: null, status: 'Not started', progress: 0 };
function show(action: PdfParseAction, paper = entry) {
  const notify = vi.fn(() => 'toast');
  return { notify, ...render(<PdfParseButton entry={paper} action={action} />, { wrapper: ({ children }) =>
    <ToastContext.Provider value={{ notify, dismiss: vi.fn() }}>{children}</ToastContext.Provider> }) };
}
it('opens parser setup without submitting when no parser is configured', () => {
  const action = { configured: false, onStart: vi.fn(), onConfigure: vi.fn() };
  show(action);
  fireEvent.click(screen.getByRole('button', { name: '开始解析' }));
  expect(action.onConfigure).toHaveBeenCalledOnce();
  expect(action.onStart).not.toHaveBeenCalled();
});
it('reports a failed submission and allows retry without showing success', async () => {
  const action = { configured: true, onStart: vi.fn().mockRejectedValueOnce(new Error('连接失败')).mockResolvedValue(undefined), onConfigure: vi.fn() };
  const { notify } = show(action);
  fireEvent.click(screen.getByRole('button', { name: '开始解析' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', title: '开始解析失败' })));
  expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ title: '已加入解析队列' }));
  fireEvent.click(screen.getByRole('button', { name: '开始解析' }));
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: '已加入解析队列' })));
  expect(action.onStart).toHaveBeenCalledTimes(2);
});
it.each(['Queued', 'Uploading', 'Parsing'] as const)('does not resubmit a %s PDF', status => {
  const action = { configured: true, onStart: vi.fn(), onConfigure: vi.fn() };
  show(action, { ...entry, status });
  const button = screen.getByRole('button') as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button); expect(action.onStart).not.toHaveBeenCalled();
});
it('does not submit when the workspace is unavailable', () => {
  const action = { configured: true, disabled: true, onStart: vi.fn(), onConfigure: vi.fn() };
  show(action);
  fireEvent.click(screen.getByRole('button', { name: '开始解析' }));
  expect(action.onStart).not.toHaveBeenCalled();
});
it.each(['Parsed', 'No PDF'] as const)('omits the action for %s', status => {
  show({ configured: true, onStart: vi.fn(), onConfigure: vi.fn() }, { ...entry, status, pdfFileName: status === 'No PDF' ? null : entry.pdfFileName });
  expect(screen.queryByRole('button')).toBeNull();
});
