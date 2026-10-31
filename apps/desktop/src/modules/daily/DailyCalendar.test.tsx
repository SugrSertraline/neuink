// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import DailyCalendar from './DailyCalendar';
import { buildDailyCalendar } from './dailyCalendarModel';

afterEach(cleanup);

it('computes festivals from civil dates including lunar new year, without a personal profile', () => {
  expect(buildDailyCalendar('2025-01-29')).toMatchObject({ lunarDate: '正月初一', festivals: ['春节'] });
  expect(buildDailyCalendar('2024-02-10')?.festivals).toContain('春节');
  expect(buildDailyCalendar('2026-10-01')?.festivals).toContain('国庆节');
  expect(buildDailyCalendar('2023-03-22')?.lunarDate).toBe('闰二月初一');
});

it('keeps a daily almanac stable and distinguishes tomorrow and invalid dates', () => {
  const calendar = buildDailyCalendar('2026-10-26')!;
  expect(buildDailyCalendar('2026-10-26')).toEqual(calendar);
  expect(calendar.suitable.length).toBeGreaterThan(0); expect(calendar.avoid.length).toBeGreaterThan(0);
  expect(calendar.nextTerm.date > calendar.date).toBe(true);
  expect(buildDailyCalendar('2026-10-27')?.lunarDate).not.toBe(calendar.lunarDate);
  for (const date of ['2026-02-30', '2026-13-01', '2026-00-01', '2026-10-00', 'invalid', '1800-01-01']) expect(buildDailyCalendar(date)).toBeNull();
  expect(buildDailyCalendar('2024-02-29')).not.toBeNull();
});

it('updates the visible calendar for a new day and offers a bounded fallback for invalid input', () => {
  const ui = render(<DailyCalendar date="2025-01-29" />);
  expect(ui.getByText('春节')).toBeTruthy(); expect(ui.getByText('传统黄历 · 趣味参考')).toBeTruthy();
  ui.rerender(<DailyCalendar date="2026-10-01" />);
  expect(ui.getByText('国庆节')).toBeTruthy(); expect(ui.queryByText('春节')).toBeNull();
  ui.rerender(<DailyCalendar date="invalid" />);
  expect(ui.getByRole('status').textContent).toContain('暂时无法显示');
});
