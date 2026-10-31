// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { applyTitleConsistency, inspectTitleConsistency } from '@/shared/ipc/workspaceApi';
import { EntryTitleConsistency } from './EntryTitleConsistency';
import { reviewTitleConsistency } from './titleConsistencyModel';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  applyTitleConsistency: vi.fn(), inspectTitleConsistency: vi.fn()
}));
vi.mock('./titleConsistencyModel', () => ({ reviewTitleConsistency: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('offers separate corrections after an automatic parsed-title check', async () => {
  const suggestion = { entry_title: 'Draft name', pdf_file_name: 'upload.pdf',
    evidence: ['A Reliable Paper Title'], source_revision: 'rev-1' };
  const review = { suggestedTitle: 'A Reliable Paper Title', suggestedPdfFileName: 'A Reliable Paper Title.pdf',
    entryMismatch: true, pdfMismatch: true, reason: '首页标题与两个名称不同。' };
  vi.mocked(inspectTitleConsistency).mockResolvedValueOnce(suggestion).mockResolvedValueOnce({
    ...suggestion, entry_title: 'A Reliable Paper Title'
  });
  vi.mocked(reviewTitleConsistency).mockResolvedValueOnce(review).mockResolvedValueOnce({ ...review, entryMismatch: false });
  vi.mocked(applyTitleConsistency).mockResolvedValue({} as never);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = render(<EntryTitleConsistency entryId="entry-1" entryTitle="Draft name" pdfFileName="upload.pdf"
    parsed root="workspace" reloadKey={0} onRefreshEntries={refresh} />);
  fireEvent.click(await view.findByRole('button', { name: '查看标题核对结果' }));
  expect(view.getByText('A Reliable Paper Title')).toBeTruthy();
  fireEvent.click(view.getByRole('checkbox', { name: '修改 PDF 显示名称' }));
  fireEvent.click(view.getByRole('button', { name: '确认修改所选名称' }));
  await waitFor(() => expect(applyTitleConsistency).toHaveBeenCalledWith('workspace', 'entry-1', suggestion, review.suggestedTitle, true, false));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(inspectTitleConsistency).toHaveBeenCalledTimes(2));
  expect(view.getByRole('button', { name: '查看标题核对结果' })).toBeTruthy();
});

it('does not inspect a PDF without completed parsing', () => {
  render(<EntryTitleConsistency entryId="entry-1" entryTitle="Draft" pdfFileName="upload.pdf"
    parsed={false} root="workspace" reloadKey={0} onRefreshEntries={vi.fn()} />);
  expect(inspectTitleConsistency).not.toHaveBeenCalled();
});

it('shows a retry when the automatic check fails', async () => {
  vi.mocked(inspectTitleConsistency).mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce(null);
  const view = render(<EntryTitleConsistency entryId="entry-1" entryTitle="Draft" pdfFileName="upload.pdf"
    parsed root="workspace" reloadKey={0} onRefreshEntries={vi.fn()} />);
  fireEvent.click(await view.findByRole('button', { name: '查看标题核对结果' }));
  expect(view.getByRole('alert').textContent).toContain('读取失败');
  fireEvent.click(view.getByRole('button', { name: '重新检查' }));
  await waitFor(() => expect(inspectTitleConsistency).toHaveBeenCalledTimes(2));
});
