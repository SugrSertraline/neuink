// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { EntryReadingState } from '@/shared/types/domain';
import { DailyDashboardView } from './DailyDashboard';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T12:00:00')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const entries = [{ id: 'a', title: '扩散模型论文', tagIds: ['diffusion'] }, { id: 'b', title: '时序预测论文', tagIds: ['forecast'] }] as LibraryEntry[];
const states = Object.fromEntries(entries.map((entry, i) => [entry.id, {
  entry_id: entry.id, total_active_ms: 3_600_000, visited_pages: [0, 1], page_count: 10,
  version: 1, document_hash: null, mode: 'pdf', current_page_idx: 1, session_count: 1, last_read_at: null,
  daily_active_ms: { '2026-10-23': (i + 1) * 600_000, '2026-10-22': 300_000 }
}])) as Record<string, EntryReadingState>;
function setup(overrides: Partial<Parameters<typeof DailyDashboardView>[0]> = {}) {
  const props = { entries, states, loading: false, error: null, onRetry: vi.fn(), onOpenLibrary: vi.fn(), onOpenEntry: vi.fn(), ...overrides };
  return { ...render(<DailyDashboardView {...props} />), props };
}

it('shows all supplied library papers, global totals, and opens the chosen paper', () => {
  const ui = setup();
  expect(ui.getByText('今日阅读').parentElement?.textContent).toContain('30 分钟');
  expect(ui.getByText('2 小时')).toBeTruthy();
  expect(ui.getByText('2 篇')).toBeTruthy();
  expect(ui.getByRole('region', { name: '当日阅读论文' }).compareDocumentPosition(ui.getByRole('region', { name: '阅读统计' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(ui.getByRole('button', { name: '继续阅读 时序预测论文' }));
  expect(ui.props.onOpenEntry).toHaveBeenCalledWith('b');
  fireEvent.click(ui.getByRole('button', { name: '打开条目库' }));
  expect(ui.props.onOpenLibrary).toHaveBeenCalledOnce();
});

it('keeps the reading list compact, expands all papers, and resets expansion on a new day', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ ...entries[0], id: `paper-${i}`, title: `论文 ${i}` }));
  const ui = setup({ entries: many, states: Object.fromEntries(many.map(entry => [entry.id, { ...states.a, entry_id: entry.id }])) });
  const papers = within(ui.getByRole('region', { name: '当日阅读论文' }));
  expect(papers.getAllByRole('listitem')).toHaveLength(4);
  fireEvent.click(papers.getByRole('button', { name: '展开全部 8 篇' }));
  expect(papers.getAllByRole('listitem')).toHaveLength(8);
  fireEvent.click(papers.getByRole('button', { name: '继续阅读 论文 7' }));
  expect(ui.props.onOpenEntry).toHaveBeenCalledWith('paper-7');
  fireEvent.click(ui.getByRole('button', { name: '前一天' }));
  expect(within(ui.getByRole('region', { name: '当日阅读论文' })).getAllByRole('listitem')).toHaveLength(4);
});

it('changes date within one view, keeps cumulative totals, and returns to today', () => {
  const ui = setup();
  fireEvent.click(ui.getByRole('button', { name: '前一天' }));
  expect((ui.getByLabelText('看板日期') as HTMLInputElement).value).toBe('2026-10-22');
  expect(ui.getByText('当日阅读').parentElement?.textContent).toContain('10 分钟');
  expect(ui.getByText('累计阅读').parentElement?.textContent).toContain('2 小时');
  fireEvent.click(ui.getByRole('button', { name: /^今天$/ }));
  expect((ui.getByLabelText('看板日期') as HTMLInputElement).value).toBe('2026-10-23');
  expect((ui.getByRole('button', { name: '后一天' }) as HTMLButtonElement).disabled).toBe(true);
});

it('makes the daily chart keyboard-accessible and excludes future dates', () => {
  const ui = setup();
  fireEvent.click(within(within(ui.getByRole('region', { name: '柱状图' })).getByRole('group', { name: '每日阅读时长' })).getByRole('button', { name: /2026-10-22/ }));
  expect(ui.getByText('当日阅读').parentElement?.textContent).toContain('10 分钟');
  fireEvent.change(ui.getByLabelText('看板日期'), { target: { value: '2026-10-24' } });
  expect((ui.getByLabelText('看板日期') as HTMLInputElement).value).toBe('2026-10-22');
});

it.each([
  { loading: true, error: null, role: 'status', text: '正在读取阅读记录…' },
  { loading: false, error: '记录读取失败', role: 'alert', text: '记录读取失败' }
])('does not display false zero totals while $role', ({ role, text, ...overrides }) => {
  const ui = setup(overrides);
  expect(ui.getByRole(role).textContent).toContain(text);
  expect(ui.queryByLabelText('阅读汇总')).toBeNull();
  if (overrides.error) { fireEvent.click(ui.getByRole('button', { name: '重试' })); expect(ui.props.onRetry).toHaveBeenCalledOnce(); }
});

it('distinguishes an empty library from a day without reading', () => {
  const ui = setup({ entries: [] });
  expect(ui.getByText('资料库还没有论文。')).toBeTruthy();
  ui.rerender(<DailyDashboardView {...ui.props} entries={entries} states={{}} />);
  expect(ui.getByText('这一天还没有阅读记录。')).toBeTruthy();
});

it('keeps the selected date while new reading state arrives', () => {
  const ui = setup();
  fireEvent.click(ui.getByRole('button', { name: '前一天' }));
  ui.rerender(<DailyDashboardView {...ui.props} states={{ ...states, a: { ...states.a, daily_active_ms: { '2026-10-22': 900_000 } } }} />);
  expect((ui.getByLabelText('看板日期') as HTMLInputElement).value).toBe('2026-10-22');
  expect(ui.getByText('当日阅读').parentElement?.textContent).toContain('20 分钟');
});
