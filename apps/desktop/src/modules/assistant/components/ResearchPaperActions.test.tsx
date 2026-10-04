// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import { approveResearchImport, previewResearchImport, runResearchTool, type ResearchPaper } from '@/shared/ipc/researchApi';
import { ResearchPaperAction, ResearchPaperActionsProvider } from './ResearchPaperActions';
import { getAssistantBackgroundRuns, setAssistantBackgroundRun, stopAssistantBackgroundRun } from './assistantBackgroundRuns';
import { ChatMessage } from './ChatMessage';
import { setAssistantDebug } from '@/shared/lib/assistantDebug';

vi.mock('@/shared/ipc/researchApi', async original => ({
  ...await original<typeof import('@/shared/ipc/researchApi')>(),
  previewResearchImport: vi.fn(), approveResearchImport: vi.fn(), runResearchTool: vi.fn()
}));
const paper: ResearchPaper = { id: 'paper', title: '真实论文', authors: ['A'], year: '2026',
  doi: '', url: 'https://example.com/paper', pdf_url: 'https://example.com/paper.pdf', abstract_text: '摘要', provider: 'arxiv', evidence_level: 'abstract' };
const notify = vi.fn(() => 'toast');
beforeEach(() => {
  setAssistantDebug(false);
  vi.clearAllMocks();
  vi.mocked(previewResearchImport).mockResolvedValue([paper]);
  vi.mocked(approveResearchImport).mockResolvedValue();
  vi.mocked(runResearchTool).mockResolvedValue({ results: [{ id: paper.id, status: 'imported' }] });
});
afterEach(() => { cleanup(); setAssistantDebug(false); setAssistantBackgroundRun(null); });
function ui(copies = 1) {
  return render(<ToastContext.Provider value={{ notify, dismiss: vi.fn() }}>
    <ResearchPaperActionsProvider root="root">{Array.from({ length: copies }, (_, index) => <ResearchPaperAction key={index} paper={paper} />)}</ResearchPaperActionsProvider>
  </ToastContext.Provider>);
}
async function prepare(view: ReturnType<typeof ui>) {
  fireEvent.click(view.getAllByRole('button', { name: '添加到本地' })[0]);
  await waitFor(() => expect(view.getAllByRole('button', { name: '确认添加' }).length).toBeGreaterThan(0));
}

it('requires actual preview and explicit approval before importing and reports success without claiming parsing', async () => {
  const view = ui(); await prepare(view);
  expect(runResearchTool).not.toHaveBeenCalled();
  expect(approveResearchImport).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '确认添加' }));
  await waitFor(() => expect(view.getByRole('button', { name: '已在本地' })).toBeTruthy());
  expect(approveResearchImport).toHaveBeenCalledWith('root', ['paper'], [paper], expect.any(String));
  expect(runResearchTool).toHaveBeenCalledWith('import_papers', { root: 'root', paper_ids: ['paper'] }, expect.any(AbortSignal), expect.any(String));
  expect(view.getByRole('status').textContent).toContain('尚未解析');
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  expect(getAssistantBackgroundRuns()).toHaveLength(0);
});
it('renders the selected paper inside the answer with its own confirmed import and collapses other candidates', async () => {
  const other = { ...paper, id: 'other', title: '未被推荐的候选' };
  const message = { message_id: 'structured', role: 'assistant' as const, created_at: '', source_links: [],
    content: '推荐如下：\n```neuink-papers\n{"items":[{"ref":"research:paper","group":"视觉方向","reason":"与问题相关，但会议归属待核实。"}]}\n```\n覆盖范围有限。',
    parts: [{ type: 'tool-result' as const, id: 'search', toolName: 'search_papers', summary: '', researchPapers: [other, paper] }] };
  const view = render(<ToastContext.Provider value={{ notify, dismiss: vi.fn() }}><ResearchPaperActionsProvider root="root">
    <ChatMessage message={message} streaming={false} onOpenSource={vi.fn()} />
  </ResearchPaperActionsProvider></ToastContext.Provider>);
  const list = within(view.getByRole('region', { name: '推荐论文' }));
  expect(list.getByRole('link', { name: '真实论文' }).getAttribute('href')).toBe(paper.url);
  expect(list.queryByText(other.title)).toBeNull();
  expect(list.getByText('与问题相关，但会议归属待核实。')).toBeTruthy();
  expect(view.getByText('其他检索结果（1）').closest('details')?.open).toBe(false);
  expect(view.container.textContent).not.toContain('research:paper');
  fireEvent.click(list.getByRole('button', { name: '添加到本地' }));
  await waitFor(() => expect(list.getByRole('button', { name: '确认添加' })).toBeTruthy());
  expect(runResearchTool).not.toHaveBeenCalled();
  fireEvent.click(list.getByRole('button', { name: '确认添加' }));
  await waitFor(() => expect(list.getByRole('status').textContent).toContain('PDF 已下载'));
  expect(previewResearchImport).toHaveBeenCalledExactlyOnceWith('root', ['paper']);
});
it('hides incomplete selections while streaming and refuses unverified recommendation IDs', () => {
  const base = { message_id: 'partial', role: 'assistant' as const, created_at: '', source_links: [], parts: [], content: '```neuink-papers\n{"items":' };
  const view = render(<ChatMessage message={base} streaming onOpenSource={vi.fn()} />);
  expect(view.getByText('正在整理论文推荐…')).toBeTruthy();
  expect(view.container.textContent).not.toContain('"items"');
  view.rerender(<ChatMessage message={{ ...base, content: '```neuink-papers\n{"items":[{"ref":"research:invented","reason":"Imagined"}]}\n```' }} streaming={false} onOpenSource={vi.fn()} />);
  expect(view.getByRole('alert').textContent).toContain('没有对应的检索记录');
  expect(view.queryByRole('button', { name: '添加到本地' })).toBeNull();
});
it('shares in-flight and completed state between chat and reading tab and blocks duplicate clicks', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(runResearchTool).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = ui(2); await prepare(view);
  fireEvent.click(view.getAllByRole('button', { name: '确认添加' })[0]);
  await waitFor(() => expect(runResearchTool).toHaveBeenCalledTimes(1));
  expect(view.getAllByRole('button', { name: '正在添加…' })).toHaveLength(2);
  expect(getAssistantBackgroundRuns()).toHaveLength(1);
  await act(async () => finish({ results: [{ id: 'paper', status: 'already_in_library' }] }));
  expect(view.getAllByRole('button', { name: '已在本地' })).toHaveLength(2);
  expect(notify).toHaveBeenCalledTimes(1);
});
it('cancels without granting permission or writing', async () => {
  const view = ui(); await prepare(view);
  fireEvent.click(view.getByRole('button', { name: '取消' }));
  expect(view.queryByRole('button', { name: '确认添加' })).toBeNull();
  expect(approveResearchImport).not.toHaveBeenCalled();
  expect(runResearchTool).not.toHaveBeenCalled();
});
it('reports failed downloads and requires a fresh preview/confirmation on retry', async () => {
  const raw = 'Timeout HTTP 504 Authorization: Bearer sk-private C:\\Users\\Alice\\private.pdf <body>REMOTE_BODY</body>';
  vi.mocked(runResearchTool).mockResolvedValue({ results: [{ id: 'paper', status: 'failed', error: raw }] });
  const view = ui(); await prepare(view);
  fireEvent.click(view.getByRole('button', { name: '确认添加' }));
  await waitFor(() => expect(view.getByRole('alert').textContent).toBe('论文添加未完成，请先核对条目库。'));
  expect(view.queryByRole('button', { name: '已在本地' })).toBeNull();
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', description: '论文添加未完成，请先核对条目库。' }));
  act(() => setAssistantDebug(true));
  expect(view.getByRole('alert').textContent).toContain('调试：请求超时 · HTTP 504');
  for (const secret of ['sk-private', 'Authorization', 'Alice', 'REMOTE_BODY']) expect(view.container.innerHTML).not.toContain(secret);
  fireEvent.click(view.getByRole('button', { name: '重试添加' }));
  await waitFor(() => expect(previewResearchImport).toHaveBeenCalledTimes(2));
  expect(runResearchTool).toHaveBeenCalledTimes(1);
});
it.each([{ papers: [] as ResearchPaper[] }, { papers: [{ ...paper, pdf_url: null }] }])('handles expired/unavailable papers without writing', async ({ papers }) => {
  vi.mocked(previewResearchImport).mockResolvedValue(papers);
  const view = ui(); fireEvent.click(view.getByRole('button', { name: '添加到本地' }));
  await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
  expect(runResearchTool).not.toHaveBeenCalled();
});
it('shares Sciverse confirmation and completion across chat and reading views', async () => {
  const add = vi.fn().mockResolvedValue({ entryId: 'entry', status: 'created_metadata_only', message: '仅保存元数据，PDF 不可用。HTTP 503 Authorization: Bearer sk-private <html>REMOTE_BODY</html>' });
  const message = { message_id: 'reply', content: '论文 [S1]', role: 'assistant' as const, created_at: '',
    source_links: [{ provider: 'sciverse' as const, doc_id: 'remote', title: '论文', quote: '证据' }] };
  const view = render(<ToastContext.Provider value={{ notify, dismiss: vi.fn() }}><ResearchPaperActionsProvider root="root">
    <ChatMessage message={message} streaming={false} onOpenSource={vi.fn()} onAddSciverseSource={add} />
    <ChatMessage message={message} streaming={false} reading onOpenSource={vi.fn()} onAddSciverseSource={add} />
  </ResearchPaperActionsProvider></ToastContext.Provider>);
  fireEvent.click(view.getAllByRole('button', { name: '一键加入文库' })[0]);
  expect(view.getAllByRole('button', { name: '确认添加' })).toHaveLength(2);
  expect(add).not.toHaveBeenCalled();
  fireEvent.click(view.getAllByRole('button', { name: '确认添加' })[0]);
  await waitFor(() => expect(view.getAllByRole('button', { name: '已加入（元数据）' })).toHaveLength(2));
  expect(view.getAllByRole('status')).toHaveLength(2);
  expect(view.getAllByRole('status')[0].textContent).toBe('已保存元数据，PDF 和远程全文未能保存，请在来源页面核对。');
  act(() => setAssistantDebug(true));
  expect(view.container.innerHTML).not.toContain('sk-private');
  expect(view.container.innerHTML).not.toContain('REMOTE_BODY');
  expect(add).toHaveBeenCalledTimes(1);
});
it('does not start a download when stopped while approving', async () => {
  let finish!: () => void;
  vi.mocked(approveResearchImport).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = ui(); await prepare(view);
  fireEvent.click(view.getByRole('button', { name: '确认添加' }));
  stopAssistantBackgroundRun(getAssistantBackgroundRuns()[0].abortController);
  await act(async () => finish());
  expect(runResearchTool).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toContain('已停止');
  expect(getAssistantBackgroundRuns()).toHaveLength(0);
});
it('allows a confirmed import to finish after the view closes and releases its background record', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(runResearchTool).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = ui(); await prepare(view);
  fireEvent.click(view.getByRole('button', { name: '确认添加' }));
  await waitFor(() => expect(runResearchTool).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => finish({ results: [{ id: 'paper', status: 'imported' }] }));
  expect(getAssistantBackgroundRuns()).toHaveLength(0);
  expect(notify).toHaveBeenCalledTimes(1);
});
