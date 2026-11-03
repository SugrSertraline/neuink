// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DailySidebar } from './DailySidebar';
const state = vi.hoisted(() => ({ root: null as string | null, loading: false, error: null as string | null, refresh: vi.fn(), recommendations: vi.fn() }));
vi.mock('./DailyContext', () => ({ useDaily: () => ({ root: state.root, today: '2026-10-27' }) }));
vi.mock('./RecommendationContext', () => ({ useRecommendations: () => ({ ensureToday: state.recommendations }) }));
vi.mock('./useDailyAdvice', () => ({ useDailyAdvice: () => ({ phase: 'idle', refresh: state.refresh }) }));
vi.mock('@/modules/reader/useLibraryReadingStates', () => ({ useLibraryReadingStates: () => ({ states: {}, loading: state.loading, error: state.error, refresh: state.refresh }) }));
beforeEach(() => { state.root = null; state.loading = false; state.error = null; vi.clearAllMocks(); });
afterEach(cleanup);
it('shows only reading advice when there is no workspace', () => {
  render(<DailySidebar active />);
  expect(screen.getByText('打开资料库后，按当天阅读情况为你推荐下一步。')).toBeTruthy();
  expect(screen.queryByRole('region', { name: '星座运势' })).toBeNull();
  expect(screen.queryByRole('button', { name: '每日推荐显示设置' })).toBeNull();
  expect(screen.queryByRole('region', { name: '今天吃什么' })).toBeNull();
});
it('shows loading and retry states for reading records', () => {
  state.root = 'test'; state.loading = true;
  const ui = render(<DailySidebar active />);
  expect(screen.getByRole('status').textContent).toContain('正在了解');
  state.loading = false; state.error = 'failed'; ui.rerender(<DailySidebar active />);
  expect(screen.getByRole('alert').textContent).toContain('无法读取');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(state.refresh).toHaveBeenCalledOnce();
});
it('opens recommended papers and allows refreshing advice', () => {
  state.root = 'test'; const open = vi.fn();
  render(<DailySidebar active onOpenRecommendations={open} />);
  expect(screen.getByLabelText('今日阅读情况').textContent).toContain('0');
  fireEvent.click(screen.getByRole('button', { name: '查看论文推荐' }));
  fireEvent.click(screen.getByRole('button', { name: '刷新每日建议' }));
  expect(open).toHaveBeenCalledOnce(); expect(state.refresh).toHaveBeenCalledOnce();
});
