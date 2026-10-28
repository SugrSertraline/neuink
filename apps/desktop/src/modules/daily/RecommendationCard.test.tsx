// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResearchPaperActionsProvider } from '@/modules/assistant/components/ResearchPaperActions';
import { ToastContext } from '@/shared/hooks/useToast';
import { approveResearchImport, previewResearchImport, runResearchTool } from '@/shared/ipc/researchApi';
import { RecommendationCard } from './RecommendationCard';
import type { RecommendedPaper } from './RecommendationContext';

vi.mock('@/shared/ipc/researchApi', async original => ({
  ...await original<typeof import('@/shared/ipc/researchApi')>(),
  previewResearchImport: vi.fn(), approveResearchImport: vi.fn(), runResearchTool: vi.fn(),
}));
const paper: RecommendedPaper = { id: 'card', title: '论文卡片', authors: ['作者 A', '作者 B'], year: '2026',
  doi: '', url: 'https://example.com/paper', pdf_url: 'https://example.com/paper.pdf',
  abstract_text: '完整摘要包含方法与限制。'.repeat(50), provider: 'arxiv', evidence_level: 'abstract',
  published: '2026-10-24', updated: '2026-10-24', categories: ['cs.LG'], reasons: ['匹配标签：扩散模型', '近期阅读方向'], matched_interests: ['diffusion'] };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewResearchImport).mockResolvedValue([paper]);
  vi.mocked(approveResearchImport).mockResolvedValue();
  vi.mocked(runResearchTool).mockResolvedValue({ results: [{ id: paper.id, status: 'imported' }] });
});
afterEach(cleanup);
const props = () => ({ paper, busy: false, ignored: false, onIgnore: vi.fn() });

it('exposes the complete abstract by keyboard, restores focus, and keeps feedback explicit', async () => {
  const values = props(); const ui = render(<RecommendationCard {...values} />);
  expect(ui.queryByRole('link', { name: paper.title })).toBeNull();
  fireEvent.click(ui.getByText(paper.title)); expect(ui.queryByRole('dialog')).toBeNull();
  expect(ui.getByRole('link', { name: '查看详情' }).getAttribute('href')).toBe(paper.url);
  const trigger = ui.getByRole('button', { name: '预览' });
  act(() => trigger.focus()); fireEvent.click(trigger);
  const detail = await ui.findByRole('dialog');
  expect(detail.textContent).toContain(paper.abstract_text);
  expect(detail.textContent).toContain('作者 A、作者 B');
  expect(detail.textContent).toContain('近期阅读方向');
  expect(ui.queryByRole('link', { name: '打开论文网页' })).toBeNull();
  fireEvent.keyDown(detail, { key: 'Escape' });
  await waitFor(() => expect(ui.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(ui.getByRole('button', { name: '忽略' }));
  expect(values.onIgnore).toHaveBeenCalledTimes(1);
  expect(ui.getByRole('button', { name: '添加到本地' }).hasAttribute('disabled')).toBe(true);
  ui.rerender(<RecommendationCard {...values} ignored busy />);
  expect(ui.getByText('已忽略')).toBeTruthy();
  expect(ui.getByRole('button', { name: '恢复推荐' }).hasAttribute('disabled')).toBe(true);
});

it('preserves preview, cancellation, and explicit confirmed import inside the card', async () => {
  const ui = render(<ToastContext.Provider value={{ notify: vi.fn(() => 'toast'), dismiss: vi.fn() }}>
    <ResearchPaperActionsProvider root="isolated"><RecommendationCard {...props()} /></ResearchPaperActionsProvider>
  </ToastContext.Provider>);
  fireEvent.click(ui.getByRole('button', { name: '添加到本地' }));
  await ui.findByRole('button', { name: '确认添加' });
  expect(approveResearchImport).not.toHaveBeenCalled(); expect(runResearchTool).not.toHaveBeenCalled();
  fireEvent.click(ui.getByRole('button', { name: '取消' }));
  expect(ui.queryByRole('button', { name: '确认添加' })).toBeNull();
  fireEvent.click(ui.getByRole('button', { name: '添加到本地' }));
  fireEvent.click(await ui.findByRole('button', { name: '确认添加' }));
  await ui.findByRole('button', { name: '已在本地' });
  expect(approveResearchImport).toHaveBeenCalledTimes(1); expect(runResearchTool).toHaveBeenCalledTimes(1);
  expect(ui.getByRole('status').textContent).toContain('尚未解析');
});
