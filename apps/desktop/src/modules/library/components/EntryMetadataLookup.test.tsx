// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EntryMetadataLookup, fillEmptyPaperFields } from './EntryMetadataLookup';
import { runResearchTool, type ResearchPaper } from '@/shared/ipc/researchApi';
vi.mock('@/shared/ipc/researchApi', async importOriginal => ({ ...(await importOriginal<typeof import('@/shared/ipc/researchApi')>()), runResearchTool: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const paper: ResearchPaper = { id: 'arxiv:2401.00001', title: 'A real paper', authors: ['A Author'], year: '2024', abstract_text: '', doi: '10.1234/example', url: 'https://arxiv.org/abs/2401.00001', pdf_url: null, provider: 'arxiv', evidence_level: 'metadata' };
const definitions = [
  { name: '发表年份', kind: 'date' as const, date_precision: 'year' as const, hidden: false, options: [] },
  { name: 'DOI', kind: 'text' as const, hidden: false, options: [] },
  { name: '论文链接', kind: 'text' as const, hidden: false, options: [] },
  { name: '出版类型', kind: 'select' as const, hidden: false, options: ['期刊', '预印本'] },
];
it('fills only enabled compatible blanks, preserving existing values and unrelated fields', () => {
  const fields = [{ id: '1', key: 'DOI', value: '10.9999/existing' }, { id: '2', key: '备注', value: '保留' }];
  const result = fillEmptyPaperFields(fields, definitions, paper);
  expect(result).toEqual(expect.arrayContaining([fields[0], fields[1], expect.objectContaining({ key: '发表年份', value: '2024' }), expect.objectContaining({ key: '出版类型', value: '预印本' })]));
  expect(fields).toHaveLength(2);
  expect(fillEmptyPaperFields([], definitions.map(field => ({ ...field, hidden: true })), paper)).toEqual([]);
  expect(fillEmptyPaperFields([], definitions, { ...paper, provider: 'crossref' }).some(field => field.key === '出版类型')).toBe(false);
});
it('requires an explicit search and candidate selection', async () => {
  vi.mocked(runResearchTool).mockResolvedValue({ papers: [paper], errors: {} });
  const apply = vi.fn(() => 2);
  render(<EntryMetadataLookup root="test" title="A real paper" onApply={apply}/>);
  fireEvent.click(screen.getByRole('button', { name: '在线查找属性' }));
  expect(runResearchTool).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查找' }));
  expect(await screen.findByText('A real paper')).toBeTruthy();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '填充空白' }));
  expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: paper.id }));
  expect(screen.getByText(/已填充 2 项/)).toBeTruthy();
});
it('shows network failures without modifying the entry', async () => {
  vi.mocked(runResearchTool).mockRejectedValue(new Error('网络不可用'));
  const apply = vi.fn(); render(<EntryMetadataLookup root="test" title="paper" onApply={apply}/>);
  fireEvent.click(screen.getByRole('button', { name: '在线查找属性' })); fireEvent.click(screen.getByRole('button', { name: '查找' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('网络不可用'));
  expect(apply).not.toHaveBeenCalled();
});

it('keeps results when one source fails', async () => {
  vi.mocked(runResearchTool).mockRejectedValueOnce(new Error('arXiv 超时')).mockResolvedValueOnce({ papers: [paper] });
  render(<EntryMetadataLookup root="test" title="A real paper" onApply={() => 0}/>);
  fireEvent.click(screen.getByRole('button', { name: '在线查找属性' }));
  fireEvent.click(screen.getByRole('button', { name: '查找' }));
  expect(await screen.findByText('A real paper')).toBeTruthy();
  expect(screen.getByText(/部分数据源不可用：arXiv/)).toBeTruthy();
  expect(runResearchTool).toHaveBeenCalledWith('search_papers', expect.objectContaining({ source: 'arxiv', query: 'all:"A real paper"' }), expect.any(AbortSignal));
});
