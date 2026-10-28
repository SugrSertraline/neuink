// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { EntryReadingState, ReadingSession } from '@/shared/types/domain';
import { buildReadingTrend, readReadingChartPreferences, persistReadingChartPreferences, READING_CHART_STORAGE_KEY } from './readingTrend';

afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });
const segment = (id: string, hour: number, minutes: number): ReadingSession => ({ id, local_date: '2026-10-23', started_at: `2026-10-23T${hour}:00:00Z`, ended_at: `2026-10-23T${hour}:${String(minutes).padStart(2, '0')}:00Z`, active_ms: minutes * 60_000 });
const record = (minutes: number, reading_sessions?: ReadingSession[]): EntryReadingState => ({
  entry_id: 'fixture', version: 1, document_hash: null, mode: 'pdf', current_page_idx: 0, page_count: 1,
  visited_pages: [0], total_active_ms: minutes * 60_000, session_count: reading_sessions?.length ?? 0, last_read_at: null,
  daily_active_ms: { '2026-10-23': minutes * 60_000 }, reading_sessions,
});

it('uses the first, last, longest and shortest period of each day across papers in chronological order', () => {
  const a = record(65, [segment('middle', 13, 40), segment('first', 10, 15), segment('short', 15, 10)]);
  const b = record(25, [segment('last', 18, 25)]);
  const result = buildReadingTrend(['b', 'a', 'a'], { a, b, ignored: record(999) }, '2026-10-23', 28);
  const day = result.days[result.days.length - 1];
  expect(day.activeMs).toBe(90 * 60_000);
  expect(day.candle).toEqual({ open: 15 * 60_000, close: 25 * 60_000, high: 40 * 60_000, low: 10 * 60_000 });
  expect(day.sessions.map(item => item.id)).toEqual(['first', 'middle', 'short', 'last']);
  expect(result.days.slice(0, -1).every(item => item.candle === null)).toBe(true);
});

it('does not invent daily candles from legacy totals or partial records', () => {
  for (const state of [record(90), record(90, [segment('known', 10, 15)])]) {
    const day = buildReadingTrend(['a'], { a: state }, '2026-10-23', 28).days.slice(-1)[0];
    expect(day.candle).toBeNull();
    expect(day.missingSessionMs).toBeGreaterThan(0);
    expect(day.activeMs).toBe(90 * 60_000);
  }
});

it('renders one period as equal OHLC and recomputes a growing checkpoint without double counting', () => {
  const first = segment('one', 10, 15);
  const before = buildReadingTrend(['a'], { a: record(15, [first]) }, '2026-10-23', 28).days.slice(-1)[0];
  expect(before.candle).toEqual({ open: 900_000, close: 900_000, high: 900_000, low: 900_000 });
  const after = buildReadingTrend(['a'], { a: record(25, [{ ...first, active_ms: 1_500_000 }]) }, '2026-10-23', 28).days.slice(-1)[0];
  expect(after.candle?.close).toBe(1_500_000);
  expect(after.sessions).toHaveLength(1);
});

it('builds an exact rolling range across year boundaries without future dates', () => {
  const result = buildReadingTrend([], {}, '2026-01-01', 28);
  expect(result.days[0].date).toBe('2025-12-05');
  expect(result.days.slice(-1)[0]?.date).toBe('2026-01-01');
  expect(result.days).toHaveLength(28);
  expect(buildReadingTrend([], {}, '2026-01-04', 90).days).toHaveLength(90);
  expect(buildReadingTrend([], {}, '2026-01-04', 0).days).toHaveLength(7);
});

const sharedRange = (days: number) => ({ daysByMode: { bar: days, line: days, heatmap: days, candle: days } });

it('migrates old chart preferences into independent ranges and bounds each range', () => {
  for (const [stored, days] of [[{ mode: 'candle', weeks: 12 }, 84], [{ mode: 'bar', weeks: 1 }, 28], [{ days: 900 }, 90], [{ days: 1 }, 7]]) {
    window.localStorage.setItem(READING_CHART_STORAGE_KEY, JSON.stringify(stored));
    expect(readReadingChartPreferences()).toEqual(sharedRange(days as number));
  }
  const independent = { daysByMode: { bar: 14, line: 28, heatmap: 56, candle: 90 } };
  persistReadingChartPreferences(independent);
  expect(readReadingChartPreferences()).toEqual(independent);
  window.localStorage.setItem(READING_CHART_STORAGE_KEY, JSON.stringify({ daysByMode: { bar: 900, line: 1, heatmap: 'oops' } }));
  expect(readReadingChartPreferences()).toEqual({ daysByMode: { bar: 90, line: 7, heatmap: 28, candle: 28 } });
});

it('recovers from corrupt or unavailable preference storage', () => {
  for (const value of ['invalid json', 'null', '{"days":"oops"}']) {
    window.localStorage.setItem(READING_CHART_STORAGE_KEY, value);
    expect(readReadingChartPreferences()).toEqual(sharedRange(28));
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(readReadingChartPreferences()).toEqual(sharedRange(28));
  expect(() => persistReadingChartPreferences(sharedRange(42))).not.toThrow();
});
