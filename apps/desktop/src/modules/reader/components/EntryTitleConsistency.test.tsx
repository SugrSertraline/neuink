// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { applyTitleConsistency, confirmTitleConsistency, inspectTitleConsistency } from '@/shared/ipc/workspaceApi';
import { EntryTitleConsistency } from './EntryTitleConsistency';
import { reviewTitleConsistency } from './titleConsistencyModel';

vi.mock('@/shared/ipc/workspaceApi', () => ({
  applyTitleConsistency: vi.fn(), confirmTitleConsistency: vi.fn(), inspectTitleConsistency: vi.fn()
}));
vi.mock('./titleConsistencyModel', () => ({ reviewTitleConsistency: vi.fn() }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('shows a spinner beside the title until the automatic check finishes', async () => {
  let finish: (value: Awaited<ReturnType<typeof inspectTitleConsistency>>) => void = () => {};
  vi.mocked(inspectTitleConsistency).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<EntryTitleConsistency entryId="entry-1" entryTitle="Paper" pdfFileName="paper.pdf"
    parsed root="workspace" reloadKey={0} onRefreshEntries={vi.fn()} />);
  expect(view.getByRole('status', { name: '正在核对论文标题' }).querySelector('.animate-spin')).toBeTruthy();
  await act(async () => finish({ entry_title: 'Paper', pdf_file_name: 'paper.pdf', evidence: ['Paper'],
    source_revision: 'rev-spinner', confirmed: true }));
  expect(view.queryByRole('status')).toBeNull();
  expect(view.queryByRole('button', { name: '查看标题核对结果' })).toBeNull();
  expect(reviewTitleConsistency).not.toHaveBeenCalled();
});

it('keeps uncertain checks visible after dismissing the dialog and lets the user confirm the current names', async () => {
  const inspection = { entry_title: 'Paper', pdf_file_name: 'paper.pdf', evidence: ['Unclear first page'],
    source_revision: 'rev-uncertain', confirmed: false };
  vi.mocked(inspectTitleConsistency).mockResolvedValue(inspection);
  vi.mocked(reviewTitleConsistency).mockResolvedValue({ status: 'uncertain', reason: '首页标题不清晰。' });
  vi.mocked(confirmTitleConsistency).mockResolvedValue(undefined);
  const view = render(<EntryTitleConsistency entryId="entry-1" entryTitle="Paper" pdfFileName="paper.pdf"
    parsed root="workspace" reloadKey={0} onRefreshEntries={vi.fn()} />);
  fireEvent.click(await view.findByRole('button', { name: '查看标题核对结果' }));
  expect(view.getByText('首页标题不清晰。')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '稍后处理' }));
  expect(view.getByRole('button', { name: '查看标题核对结果' })).toBeTruthy();
  expect(reviewTitleConsistency).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole('button', { name: '查看标题核对结果' }));
  fireEvent.click(view.getByRole('button', { name: '确认当前名称无误' }));
  await waitFor(() => expect(confirmTitleConsistency).toHaveBeenCalledWith('workspace', 'entry-1', inspection));
  await waitFor(() => expect(view.queryByRole('button', { name: '查看标题核对结果' })).toBeNull());
});

it('warns when parsed first-page evidence is missing instead of treating it as a match', async () => {
  vi.mocked(inspectTitleConsistency).mockResolvedValue({ entry_title: 'Paper', pdf_file_name: 'paper.pdf',
    evidence: [], source_revision: 'rev-empty', confirmed: false });
  const view = render(<EntryTitleConsistency entryId="entry-1" entryTitle="Paper" pdfFileName="paper.pdf"
    parsed root="workspace" reloadKey={0} onRefreshEntries={vi.fn()} />);
  fireEvent.click(await view.findByRole('button', { name: '查看标题核对结果' }));
  expect(view.getByText(/PDF 首页没有可用于核对标题的解析文字/)).toBeTruthy();
  expect(reviewTitleConsistency).not.toHaveBeenCalled();
});

it('hides the prompt after a definite match', async () => {
  vi.mocked(inspectTitleConsistency).mockResolvedValue({ entry_title: 'Paper', pdf_file_name: 'paper.pdf',
    evidence: ['Paper'], source_revision: 'rev-match', confirmed: false });
  vi.mocked(reviewTitleConsistency).mockResolvedValue(null);
  const view = render(<EntryTitleConsistency entryId="entry-1" entryTitle="Paper" pdfFileName="paper.pdf"
    parsed root="workspace" reloadKey={0} onRefreshEntries={vi.fn()} />);
  await waitFor(() => expect(reviewTitleConsistency).toHaveBeenCalledOnce());
  await waitFor(() => expect(view.queryByRole('status')).toBeNull());
  expect(view.queryByRole('button', { name: '查看标题核对结果' })).toBeNull();
});

it('removes the prompt in both open views after a saved confirmation', async () => {
  let confirmed = false;
  const inspection = { entry_title: 'Paper', pdf_file_name: 'paper.pdf', evidence: ['Unclear first page'],
    source_revision: 'rev-shared', confirmed: false };
  vi.mocked(inspectTitleConsistency).mockImplementation(async () => ({ ...inspection, confirmed }));
  vi.mocked(reviewTitleConsistency).mockResolvedValue({ status: 'uncertain', reason: '无法确定。' });
  vi.mocked(confirmTitleConsistency).mockImplementation(async () => { confirmed = true; });
  const element = <EntryTitleConsistency entryId="entry-1" entryTitle="Paper" pdfFileName="paper.pdf"
    parsed root="workspace" reloadKey={0} onRefreshEntries={vi.fn()} />;
  const view = render(<>{element}<EntryTitleConsistency entryId="entry-1" entryTitle="Paper" pdfFileName="paper.pdf"
    parsed root="workspace" reloadKey={0} onRefreshEntries={vi.fn()} /></>);
  await waitFor(() => expect(view.getAllByRole('button', { name: '查看标题核对结果' })).toHaveLength(2));
  fireEvent.click(view.getAllByRole('button', { name: '查看标题核对结果' })[0]);
  fireEvent.click(view.getByRole('button', { name: '确认当前名称无误' }));
  await waitFor(() => expect(view.queryAllByRole('button', { name: '查看标题核对结果' })).toHaveLength(0));
  expect(confirmTitleConsistency).toHaveBeenCalledWith('workspace', 'entry-1', inspection);
  expect(inspectTitleConsistency).toHaveBeenCalledTimes(3);
});

it('offers separate corrections after an automatic parsed-title check', async () => {
  const suggestion = { entry_title: 'Draft name', pdf_file_name: 'upload.pdf',
    evidence: ['A Reliable Paper Title'], source_revision: 'rev-1', confirmed: false };
  const review = { status: 'mismatch' as const, suggestedTitle: 'A Reliable Paper Title', suggestedPdfFileName: 'A Reliable Paper Title.pdf',
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
  expect(view.getByRole('alert').textContent).toContain('标题核对失败：读取失败');
  fireEvent.click(view.getByRole('button', { name: '重新检查' }));
  await waitFor(() => expect(inspectTitleConsistency).toHaveBeenCalledTimes(2));
});

it('labels a failed save separately from a failed model check', async () => {
  const suggestion = { entry_title: 'Draft name', pdf_file_name: 'upload.pdf',
    evidence: ['A Reliable Paper Title'], source_revision: 'rev-2', confirmed: false };
  vi.mocked(inspectTitleConsistency).mockResolvedValue(suggestion);
  vi.mocked(reviewTitleConsistency).mockResolvedValue({ status: 'mismatch', suggestedTitle: 'A Reliable Paper Title',
    suggestedPdfFileName: 'A Reliable Paper Title.pdf', entryMismatch: true, pdfMismatch: true, reason: '首页标题。' });
  vi.mocked(applyTitleConsistency).mockRejectedValue(new Error('版本已变化'));
  const view = render(<EntryTitleConsistency entryId="entry-1" entryTitle="Draft name" pdfFileName="upload.pdf"
    parsed root="workspace" reloadKey={0} onRefreshEntries={vi.fn()} />);
  fireEvent.click(await view.findByRole('button', { name: '查看标题核对结果' }));
  fireEvent.click(view.getByRole('button', { name: '确认修改所选名称' }));
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('保存失败：版本已变化'));
});

it('does not offer a second save when the title changed but list refresh failed', async () => {
  vi.mocked(inspectTitleConsistency).mockResolvedValue({ entry_title: 'Draft name', pdf_file_name: 'upload.pdf',
    evidence: ['A Reliable Paper Title'], source_revision: 'rev-3', confirmed: false });
  vi.mocked(reviewTitleConsistency).mockResolvedValue({ status: 'mismatch', suggestedTitle: 'A Reliable Paper Title',
    suggestedPdfFileName: 'A Reliable Paper Title.pdf', entryMismatch: true, pdfMismatch: true, reason: '首页标题。' });
  vi.mocked(applyTitleConsistency).mockResolvedValue({} as never);
  const refresh = vi.fn().mockRejectedValue(new Error('刷新不可用'));
  const view = render(<EntryTitleConsistency entryId="entry-1" entryTitle="Draft name" pdfFileName="upload.pdf"
    parsed root="workspace" reloadKey={0} onRefreshEntries={refresh} />);
  fireEvent.click(await view.findByRole('button', { name: '查看标题核对结果' }));
  fireEvent.click(view.getByRole('button', { name: '确认修改所选名称' }));
  await waitFor(() => expect(view.getByRole('alert').textContent).toContain('标题已保存，但列表刷新失败：刷新不可用'));
  expect(view.queryByRole('button', { name: '确认修改所选名称' })).toBeNull();
  expect(applyTitleConsistency).toHaveBeenCalledTimes(1);
});
