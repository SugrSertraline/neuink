// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DailySidebar } from './DailySidebar';
const state = vi.hoisted(() => ({ root: null as string | null, loading: false, error: null as string | null, refresh: vi.fn(), recommendations: vi.fn() }));
vi.mock('./DailyContext', () => ({ useDaily: () => ({ root: state.root, today: '2026-10-27' }) }));
vi.mock('./RecommendationContext', () => ({ useRecommendations: () => ({ ensureToday: state.recommendations }) }));
vi.mock('./useDailyAdvice', () => ({ useDailyAdvice: () => ({ phase: 'idle', refresh: state.refresh }) }));
vi.mock('@/modules/reader/useLibraryReadingStates', () => ({ useLibraryReadingStates: () => ({ states: {}, loading: state.loading, error: state.error, refresh: state.refresh }) }));
beforeEach(() => { localStorage.clear(); state.root = null; state.loading = false; state.error = null; vi.clearAllMocks(); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);
it('shows lifestyle sections without a workspace while reading advice asks for one', async () => {
  render(<DailySidebar active />);
  expect(screen.getByText('打开资料库后，按当天阅读情况为你推荐下一步。')).toBeTruthy();
  expect(await screen.findByRole('region', { name: '今日节令与黄历' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '星座运势' })).toBeTruthy();
  expect(screen.getByRole('region', { name: '今天吃什么' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '每日推荐显示设置' })).toBeTruthy();
});
it('shows loading and retry states for reading records', () => {
  state.root = 'test'; state.loading = true;
  const ui = render(<DailySidebar active />);
  expect(screen.getByText('正在了解今天的阅读情况…')).toBeTruthy();
  state.loading = false; state.error = 'failed'; ui.rerender(<DailySidebar active />);
  expect(screen.getByRole('alert').textContent).toContain('无法读取');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(state.refresh).toHaveBeenCalledOnce();
});

it('lets the user hide a section from settings and saves that choice', () => {
  render(<DailySidebar active />);
  fireEvent.click(screen.getByRole('button', { name: '每日推荐显示设置' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '星座运势' }));
  expect(screen.queryByRole('region', { name: '星座运势' })).toBeNull();
  expect(JSON.parse(localStorage.getItem('neuink.daily.sidebar.v1')!).hidden).toContain('horoscope');
});

it('reorders the sidebar sections and keeps the order locally', () => {
  render(<DailySidebar active />);
  fireEvent.click(screen.getByRole('button', { name: '每日推荐显示设置' }));
  fireEvent.click(screen.getByRole('button', { name: '上移星座运势' }));
  expect(JSON.parse(localStorage.getItem('neuink.daily.sidebar.v1')!).order).toEqual(['calendar', 'horoscope', 'meal', 'advice']);
  const sidebar = screen.getByRole('complementary', { name: '每日智能建议' });
  const horoscope = sidebar.querySelector('[aria-label="星座运势"]')!;
  const meal = sidebar.querySelector('[aria-label="今天吃什么"]')!;
  expect(horoscope.compareDocumentPosition(meal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('shows a stable local fortune after choosing a sign', async () => {
  render(<DailySidebar active />);
  fireEvent.keyDown(screen.getByRole('combobox', { name: '选择星座' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '天秤座' }));
  expect(screen.getByText(/今日关键词/)).toBeTruthy();
  expect(screen.getByText('按日期生成，仅供娱乐参考。')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem('neuink.daily.sidebar.v1')!).zodiac).toBe('天秤座');
});

it('opens the menu editor from the food picker and saves custom choices', () => {
  render(<DailySidebar active />);
  fireEvent.click(screen.getByRole('button', { name: '编辑菜单' }));
  fireEvent.change(screen.getByLabelText('我的菜单'), { target: { value: '一食堂\n二食堂' } });
  fireEvent.click(screen.getByRole('button', { name: '保存菜单' }));
  expect(JSON.parse(localStorage.getItem('neuink.daily.sidebar.v1')!).meals).toEqual(['一食堂', '二食堂']);
});
it('opens recommended papers and allows refreshing advice', () => {
  state.root = 'test'; const open = vi.fn();
  render(<DailySidebar active onOpenRecommendations={open} />);
  expect(screen.getByLabelText('今日阅读情况').textContent).toContain('0');
  fireEvent.click(screen.getByRole('button', { name: '查看论文推荐' }));
  fireEvent.click(screen.getByRole('button', { name: '刷新每日建议' }));
  expect(open).toHaveBeenCalledOnce(); expect(state.refresh).toHaveBeenCalledOnce();
});
