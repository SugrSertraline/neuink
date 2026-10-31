// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fetchDailyHoroscope } from './dailyHoroscopeApi';
import { useDailyHoroscope } from './useDailyHoroscope';

vi.mock('./dailyHoroscopeApi', () => ({ fetchDailyHoroscope: vi.fn() }));
const data = { summary: '今天的联网运势', work: '适合整理笔记', suitable: '宜阅读', avoid: '忌拖延' };
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.mocked(fetchDailyHoroscope).mockResolvedValue(data); });
afterEach(cleanup);

it('fetches once per date and sign, reuses the saved reading, and refreshes explicitly', async () => {
  const first = renderHook(({ active, date }) => useDailyHoroscope(active, date, '天秤座'), { initialProps: { active: false, date: '2026-10-31' } });
  expect(fetchDailyHoroscope).not.toHaveBeenCalled();
  first.rerender({ active: true, date: '2026-10-31' });
  await act(async () => { await Promise.resolve(); });
  expect(first.result.current.phase).toBe('ready');
  expect(fetchDailyHoroscope).toHaveBeenCalledOnce();
  first.unmount();
  const second = renderHook(({ date }) => useDailyHoroscope(true, date, '天秤座'), { initialProps: { date: '2026-10-31' } });
  expect(second.result.current.phase).toBe('ready');
  expect(fetchDailyHoroscope).toHaveBeenCalledOnce();
  act(() => second.result.current.refresh());
  await act(async () => { await Promise.resolve(); });
  expect(fetchDailyHoroscope).toHaveBeenCalledTimes(2);
  second.rerender({ date: '2026-11-01' });
  await act(async () => { await Promise.resolve(); });
  expect(fetchDailyHoroscope).toHaveBeenCalledTimes(3);
});

it('does not repeatedly retry a failed daily request until the user asks', async () => {
  vi.mocked(fetchDailyHoroscope).mockRejectedValueOnce(new Error('offline'));
  const first = renderHook(() => useDailyHoroscope(true, '2026-10-31', '天秤座'));
  await act(async () => { await Promise.resolve(); });
  expect(first.result.current.phase).toBe('error');
  first.unmount();
  const second = renderHook(() => useDailyHoroscope(true, '2026-10-31', '天秤座'));
  expect(second.result.current.phase).toBe('error');
  expect(fetchDailyHoroscope).toHaveBeenCalledOnce();
  act(() => second.result.current.refresh());
  await act(async () => { await Promise.resolve(); });
  expect(second.result.current.phase).toBe('ready');
  expect(fetchDailyHoroscope).toHaveBeenCalledTimes(2);
});

it('ignores a late response after the selected sign changes', async () => {
  let finish!: (value: typeof data) => void;
  vi.mocked(fetchDailyHoroscope).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const ui = renderHook(({ zodiac }) => useDailyHoroscope(true, '2026-10-31', zodiac), { initialProps: { zodiac: '天秤座' } });
  const firstSignal = vi.mocked(fetchDailyHoroscope).mock.calls[0][2];
  ui.rerender({ zodiac: '白羊座' });
  expect(firstSignal.aborted).toBe(true);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { finish({ ...data, summary: '过时结果' }); });
  expect(ui.result.current.phase).toBe('ready');
  expect(ui.result.current.data?.summary).toBe('今天的联网运势');
});
