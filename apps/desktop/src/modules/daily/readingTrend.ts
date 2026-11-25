import type { EntryReadingState, ReadingSession } from '@/shared/types/domain';
import { formatLocalDate, formatReadingDuration } from '@/modules/reader/components/libraryReading';

export const READING_CHART_MODES = { bar: '柱状图', line: '折线图', heatmap: '热力图', candle: '日 K 线' } as const;
export type ReadingChartMode = keyof typeof READING_CHART_MODES;
export type ReadingChartPreferences = { daysByMode: Record<ReadingChartMode, number> };
export const READING_CHART_STORAGE_KEY = 'neuink.daily.readingChart';
export const DEFAULT_READING_CHART: ReadingChartPreferences = { daysByMode: { bar: 28, line: 28, heatmap: 28, candle: 28 } };
export const MIN_READING_DAYS = 7, MAX_READING_DAYS = 90;
export const clampReadingDays = (days: number) => Math.min(MAX_READING_DAYS, Math.max(MIN_READING_DAYS, Math.round(days)));
export type ReadingDay = {
  date: string; label: string; activeMs: number; sessions: ReadingSession[];
  missingSessionMs: number;
  candle: { open: number; close: number; high: number; low: number } | null;
};

export function formatSessionDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ''}`;
  return formatReadingDuration(ms);
}
export const readingDayLabel = (day: ReadingDay) => `${day.date}，阅读 ${formatReadingDuration(day.activeMs)}`;
export const readingCandleLabel = (day: ReadingDay) => day.candle
  ? `${day.date}，开盘 ${formatSessionDuration(day.candle.open)}，收盘 ${formatSessionDuration(day.candle.close)}，最高 ${formatSessionDuration(day.candle.high)}，最低 ${formatSessionDuration(day.candle.low)}`
  : `${day.date}，${day.activeMs > 0 ? '分段记录不完整' : '无阅读记录'}`;

export function readReadingChartPreferences(): ReadingChartPreferences {
  try {
    const value = JSON.parse(window.localStorage.getItem(READING_CHART_STORAGE_KEY) ?? 'null');
    const legacyDays = Number.isFinite(value?.days) ? value.days : [4, 8, 12].includes(value?.weeks) ? value.weeks * 7 : 28;
    const daysByMode = { ...DEFAULT_READING_CHART.daysByMode };
    for (const mode of Object.keys(READING_CHART_MODES) as ReadingChartMode[]) {
      daysByMode[mode] = clampReadingDays(Number.isFinite(value?.daysByMode?.[mode]) ? value.daysByMode[mode] : legacyDays);
    }
    return { daysByMode };
  } catch { return { daysByMode: { ...DEFAULT_READING_CHART.daysByMode } }; }
}

export function persistReadingChartPreferences(value: ReadingChartPreferences) {
  // A blocked browser preference store must not prevent viewing the reading records.
  try { window.localStorage.setItem(READING_CHART_STORAGE_KEY, JSON.stringify(value)); } catch { /* Session preference remains usable. */ }
}

export function buildReadingTrend(entryIds: string[], states: Record<string, EntryReadingState>, throughDate: string, dayCount: number) {
  const end = new Date(`${throughDate}T12:00:00`);
  const start = new Date(end);
  start.setDate(start.getDate() - clampReadingDays(dayCount) + 1);
  const records = [...new Set(entryIds)].map(id => states[id]).filter(Boolean);
  const days: ReadingDay[] = [];
  // Local calendar arithmetic keeps DST, month and year boundaries out of millisecond math.
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = formatLocalDate(cursor);
    const activeMs = records.reduce((total, state) => {
      const value = state.daily_active_ms[date] ?? 0;
      return total + (Number.isFinite(value) && value > 0 ? value : 0);
    }, 0);
    const sessions = records.flatMap(state => (state.reading_sessions ?? []).filter(item =>
      item.local_date === date && Number.isFinite(item.active_ms) && item.active_ms > 0
      && Number.isFinite(Date.parse(item.started_at)) && Number.isFinite(Date.parse(item.ended_at))))
      .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.id.localeCompare(b.id));
    const trackedMs = sessions.reduce((sum, item) => sum + item.active_ms, 0);
    const durations = sessions.map(item => item.active_ms);
    days.push({ date, label: `${cursor.getMonth() + 1}/${cursor.getDate()}`, activeMs, sessions,
      missingSessionMs: Math.max(0, activeMs - trackedMs),
      candle: sessions.length && trackedMs === activeMs ? {
        open: durations[0], close: durations[durations.length - 1], high: Math.max(...durations), low: Math.min(...durations),
      } : null,
    });
  }
  return { days };
}

export function readingChartCeiling(days: ReadingDay[], candle = false) {
  const minutes = Math.max(1, ...days.map(day => (candle ? day.candle?.high ?? 0 : day.activeMs) / 60_000));
  const unit = 10 ** Math.floor(Math.log10(minutes));
  return Math.ceil(minutes / unit) * unit * 60_000;
}
