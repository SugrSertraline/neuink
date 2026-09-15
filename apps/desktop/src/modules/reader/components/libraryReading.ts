import type { EntryReadingState } from '@/shared/types/domain';
import type { LibraryEntry } from '../../library/components/LibrarySidebar';

export function getReadingProgress(state?: EntryReadingState) {
  if (!state || state.page_count <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((state.visited_pages.length / state.page_count) * 100));
}

export function getReadingTimestamp(state?: EntryReadingState) {
  return state?.last_read_at ? new Date(state.last_read_at).getTime() : 0;
}

export function formatReadingDuration(milliseconds: number) {
  if (milliseconds < 60_000) {
    return milliseconds > 0 ? '< 1 分钟' : '0 分钟';
  }
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`;
}

export function formatLastRead(value?: string | null) {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= dayStart) {
    return `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function buildReadingOverview(
  entries: LibraryEntry[],
  readingStates: Record<string, EntryReadingState>
) {
  const states = entries.map((entry) => readingStates[entry.id]).filter(Boolean);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const dateKey = formatLocalDate(date);
    const activeMs = states.reduce((sum, state) => sum + (state.daily_active_ms[dateKey] ?? 0), 0);
    return {
      activeMs,
      date: dateKey,
      label: date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    };
  });
  const todayMs = days[days.length - 1]?.activeMs ?? 0;
  const totalMs = states.reduce((sum, state) => sum + state.total_active_ms, 0);
  return {
    completed: states.filter((state) => getReadingProgress(state) >= 100).length,
    days,
    inProgress: states.filter((state) => {
      const progress = getReadingProgress(state);
      return state.total_active_ms > 0 && progress < 100;
    }).length,
    todayMs,
    totalMs,
    weekMs: days.reduce((sum, day) => sum + day.activeMs, 0)
  };
}

export function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
