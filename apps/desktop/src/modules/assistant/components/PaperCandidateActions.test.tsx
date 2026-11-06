// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastContext } from '@/shared/hooks/useToast';
import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import { approveResearchImport, previewResearchImport, runResearchTool, type ResearchPaper } from '@/shared/ipc/researchApi';
import { setAssistantBackgroundRun } from './assistantBackgroundRuns';
import { PaperAnswerContent } from './PaperAnswerContent';
import { ResearchPaperActionsProvider } from './ResearchPaperActions';

vi.mock('@/shared/ipc/researchApi', async original => ({ ...await original<typeof import('@/shared/ipc/researchApi')>(),
  previewResearchImport: vi.fn(), approveResearchImport: vi.fn(), runResearchTool: vi.fn() }));
const papers: ResearchPaper[] = Array.from({ length: 21 }, (_, i) => ({ id: `arxiv:2401.${String(i + 1).padStart(5, '0')}v2`, title: `Paper ${i + 1}`,
  url: `https://arxiv.org/abs/2401.${String(i + 1).padStart(5, '0')}v2`, pdf_url: `https://arxiv.org/pdf/2401.${String(i + 1).padStart(5, '0')}v2`,
  authors: ['Author'], abstract_text: 'Summary', year: '2024', doi: '', provider: 'arxiv', evidence_level: 'abstract' }));
const message: ConversationMessage = { message_id: 'actions', role: 'assistant', content: '', created_at: '', source_links: [],
  parts: [{ type: 'tool-call', id: 'search', toolName: 'search_papers', status: 'done' },
    { type: 'tool-result', id: 'search', toolName: 'search_papers', summary: '', researchPapers: papers }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewResearchImport).mockImplementation(async (_, ids) => papers.filter(paper => ids.includes(paper.id)));
  vi.mocked(approveResearchImport).mockResolvedValue();
});
afterEach(() => { cleanup(); setAssistantBackgroundRun(null); });
async function setup() {
  const view = render(<TooltipProvider><ToastContext.Provider value={{ notify: () => 'test', dismiss: () => {} }}>
    <ResearchPaperActionsProvider root="fixture-only"><PaperAnswerContent message={message} content="" sources={[]} discovered={[]}
      streaming={false} onOpenSource={() => {}} renderMarkdown={text => text} /></ResearchPaperActionsProvider>
  </ToastContext.Provider></TooltipProvider>);
  fireEvent.click(view.getByText('检索候选（21）'));
  await waitFor(() => expect(view.queryByLabelText('本页检索候选')).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: '下一页候选' }));
  return view;
}
async function revisit(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole('button', { name: '上一页候选' }));
  fireEvent.click(view.getByRole('button', { name: '下一页候选' }));
}

it('keeps confirmation, in-flight and completed state across candidate unmounts without duplicate downloads', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(runResearchTool).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = await setup();
  const row = () => within(view.getByLabelText('本页检索候选')).getByRole('article');
  expect(within(row()).getByRole('link', { name: 'Paper 21' }).getAttribute('href')).toBe(papers[20].url);
  expect(previewResearchImport).not.toHaveBeenCalled();
  expect(runResearchTool).not.toHaveBeenCalled();
  fireEvent.click(within(row()).getByRole('button', { name: '添加到本地' }));
  await waitFor(() => expect(view.queryByRole('button', { name: '确认添加' })).toBeTruthy());
  expect(previewResearchImport).toHaveBeenCalledExactlyOnceWith('fixture-only', [papers[20].id]);
  await revisit(view);
  expect(view.getByRole('button', { name: '确认添加' })).toBeTruthy();
  expect(runResearchTool).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '确认添加' }));
  await waitFor(() => expect(runResearchTool).toHaveBeenCalledTimes(1));
  await revisit(view);
  expect(view.getByRole('button', { name: '正在添加…' })).toHaveProperty('disabled', true);
  await act(async () => finish({ results: [{ id: papers[20].id, status: 'imported' }] }));
  await revisit(view);
  expect(view.getByRole('button', { name: '已在本地' })).toHaveProperty('disabled', true);
  expect(previewResearchImport).toHaveBeenCalledTimes(1);
  expect(approveResearchImport).toHaveBeenCalledTimes(1);
  expect(runResearchTool).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runResearchTool).mock.calls[0][1]).toMatchObject({ root: 'fixture-only', paper_ids: [papers[20].id] });
  console.log('STEP4_JSON ' + JSON.stringify({ case_id: 'T-STEP4-IMPORT-STATES', actual: {
    selected_id: papers[20].id, phases_preserved: ['confirm', 'importing', 'done'], previews: 1, approvals: 1, imports: 1, real_network: false } }));
});

it('preserves failed state and requires a fresh preview and confirmation for retry after paging', async () => {
  vi.mocked(runResearchTool).mockResolvedValue({ results: [{ id: papers[20].id, status: 'failed', error: 'fixture failure' }] });
  const view = await setup();
  fireEvent.click(view.getByRole('button', { name: '添加到本地' }));
  await waitFor(() => expect(view.queryByRole('button', { name: '确认添加' })).toBeTruthy());
  fireEvent.click(view.getByRole('button', { name: '确认添加' }));
  await waitFor(() => expect(view.queryByRole('alert')).toBeTruthy());
  await revisit(view);
  expect(view.getByRole('alert')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: '重试添加' }));
  await waitFor(() => expect(view.queryByRole('button', { name: '确认添加' })).toBeTruthy());
  expect(previewResearchImport).toHaveBeenCalledTimes(2);
  expect(approveResearchImport).toHaveBeenCalledTimes(1);
  expect(runResearchTool).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole('button', { name: '取消' }));
  await revisit(view);
  expect(view.getByRole('button', { name: '添加到本地' })).toBeTruthy();
  expect(runResearchTool).toHaveBeenCalledTimes(1);
  console.log('STEP4_JSON ' + JSON.stringify({ case_id: 'T-STEP4-IMPORT-ERROR', actual: {
    selected_id: papers[20].id, error_preserved: true, retry_previews: 2, approvals: 1, imports: 1, retry_cancelled: true } }));
});
