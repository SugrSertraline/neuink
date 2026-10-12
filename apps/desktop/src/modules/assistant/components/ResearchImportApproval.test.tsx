// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovalPanel } from './ToolApprovalPanel';
import { decideToolApproval, getToolApprovals, requestToolApproval } from '../runtime/toolApproval';
import { approveResearchImport, previewResearchImport, rememberResearchConsent, type ResearchPaper } from '@/shared/ipc/researchApi';
vi.mock('@/shared/ipc/researchApi', () => ({ approveResearchImport: vi.fn(), previewResearchImport: vi.fn(), rememberResearchConsent: vi.fn() }));
const paper: ResearchPaper = { id: 'arxiv:123', title: '真实论文标题', authors: ['Alice'], year: '2026', abstract_text: '摘要，不是全文', doi: '', url: 'https://arxiv.org/abs/123', pdf_url: 'https://arxiv.org/pdf/123', provider: 'arxiv', evidence_level: 'abstract' };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(previewResearchImport).mockResolvedValue([paper]); vi.mocked(approveResearchImport).mockResolvedValue(); });
afterEach(() => { cleanup(); getToolApprovals().forEach(item => decideToolApproval(item.id, false)); });
function setup(signal?: AbortSignal) {
  const result = requestToolApproval('root', 'chat')({ toolName: 'import_papers', toolCallId: 'download', input: { paper_ids: [paper.id] } }, signal);
  const view = render(<ToolApprovalPanel root="root" conversationId="chat" onOpen={vi.fn()} />);
  return { result, view };
}
describe('paper download preview', () => {
  it('displays native paper details and requires explicit consent before granting a download', async () => {
    const { result, view } = setup();
    await view.findByText(paper.title);
    expect(approveResearchImport).not.toHaveBeenCalled();
    expect(view.getByText(paper.pdf_url!)).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '确认下载 1 篇' }));
    expect(await result).toBe(true);
    expect(approveResearchImport).toHaveBeenCalledWith('root', [paper.id], [paper], expect.any(String));
    expect(rememberResearchConsent).toHaveBeenCalledOnce();
  });
  it('does not enter confirmation after a failed preview', async () => {
    vi.mocked(previewResearchImport).mockRejectedValue('检索已过期');
    const { result, view } = setup();
    await expect(result).rejects.toMatchObject({ code: 'TOOL_PREFLIGHT_FAILED' });
    expect(view.queryByRole('button', { name: /确认下载/ })).toBeNull();
    expect(getToolApprovals()).toHaveLength(0);
    expect(approveResearchImport).not.toHaveBeenCalled();
  });
  it.each([{ rows: [] }, { rows: [{ ...paper, pdf_url: null }] }, { rows: [{ ...paper, pdf_url: ' ' }] }])('returns unavailable PDFs without requesting consent (%j)', async ({ rows }) => {
    vi.mocked(previewResearchImport).mockResolvedValue(rows);
    const { result, view } = setup();
    await expect(result).rejects.toMatchObject({ code: 'TOOL_NO_PUBLIC_PDF' });
    expect(view.queryByRole('button', { name: /确认下载/ })).toBeNull();
    expect(getToolApprovals()).toHaveLength(0);
    expect(approveResearchImport).not.toHaveBeenCalled();
    expect(rememberResearchConsent).not.toHaveBeenCalled();
  });
  it('counts only downloadable papers in a mixed preview and preserves the approved snapshot', async () => {
    const rows = [paper, { ...paper, id: 'crossref:456', title: '无公开 PDF 的论文', pdf_url: null }];
    vi.mocked(previewResearchImport).mockResolvedValue(rows);
    const { result, view } = setup();
    fireEvent.click(await view.findByRole('button', { name: '确认下载 1 篇' }));
    expect(await result).toBe(true);
    expect(approveResearchImport).toHaveBeenCalledWith('root', rows.map(row => row.id), rows, expect.any(String));
  });
  it('does not create a late confirmation after stopping during preview', async () => {
    let finish!: (rows: ResearchPaper[]) => void;
    vi.mocked(previewResearchImport).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const { result } = setup(controller.signal);
    const rejected = expect(result).rejects.toThrow();
    act(() => controller.abort());
    await act(async () => finish([paper]));
    await rejected;
    expect(getToolApprovals()).toHaveLength(0);
  });
  it('does not execute after rejection', async () => {
    const { result, view } = setup();
    fireEvent.click(await view.findByText('拒绝并停止'));
    expect(await result).toBe(false);
    expect(approveResearchImport).not.toHaveBeenCalled();
  });
  it('keeps a failed approval visible without silently consenting', async () => {
    vi.mocked(approveResearchImport).mockRejectedValue('论文信息已变化');
    const { view } = setup();
    await view.findByText(paper.title);
    fireEvent.click(view.getByText('确认下载 1 篇'));
    await view.findByText('论文确认未完成，请拒绝本次操作后重新检索。');
    expect(view.queryByText('论文信息已变化')).toBeNull();
    expect(getToolApprovals()).toHaveLength(1); expect(rememberResearchConsent).not.toHaveBeenCalled();
  });
  it('does not pass late consent to a stopped conversation', async () => {
    let finish!: () => void;
    vi.mocked(approveResearchImport).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController(); const { result, view } = setup(controller.signal);
    const rejected = expect(result).rejects.toThrow();
    await view.findByText(paper.title);
    fireEvent.click(view.getByText('确认下载 1 篇'));
    act(() => controller.abort()); await rejected;
    await act(async () => finish());
    await waitFor(() => expect(getToolApprovals()).toHaveLength(0));
    expect(rememberResearchConsent).not.toHaveBeenCalled();
  });
});
