import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { EntryReadingState } from '@/shared/types/domain';
import { getReadingProgress } from '@/modules/reader/components/libraryReading';

export type DailySuggestion = { id: string; title: string; reason: string; label: string; kind: 'read' | 'reflect' | 'recommendations'; entryId?: string };
export type DailyAdviceInput = { date: string; minutes: number; count: number; recent: { title: string; tags: string[]; minutes: number }[]; candidates: DailySuggestion[] };

export function buildDailyAdvice(entries: LibraryEntry[], states: Record<string, EntryReadingState>, date: string): DailyAdviceInput {
  const today = entries.filter(entry => (states[entry.id]?.daily_active_ms[date] ?? 0) > 0)
    .sort((a, b) => (states[b.id]?.daily_active_ms[date] ?? 0) - (states[a.id]?.daily_active_ms[date] ?? 0));
  const minutes = Math.round(today.reduce((sum, entry) => sum + states[entry.id].daily_active_ms[date], 0) / 60_000);
  const recent = entries.filter(entry => states[entry.id]?.last_read_at).sort((a, b) =>
    (states[b.id]?.last_read_at ?? '').localeCompare(states[a.id]?.last_read_at ?? '')).slice(0, 5);
  const tags = new Set(recent.flatMap(entry => entry.tagIds ?? []));
  const candidate = entries.filter(entry => !today.includes(entry) && getReadingProgress(states[entry.id]) < 100)
    .sort((a, b) => {
      const score = (entry: LibraryEntry) => (entry.tagIds ?? []).filter(tag => tags.has(tag)).length * 2 + (states[entry.id]?.total_active_ms ? 1 : 0);
      return score(b) - score(a) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    })[0];
  const suggestions: DailySuggestion[] = [];
  if (!today.length && candidate) suggestions.push({ id: 'read', kind: 'read', entryId: candidate.id, title: candidate.title,
    reason: '今天还没有阅读记录，先花 10 分钟读一篇；优先延续近期关注的方向。', label: '开始阅读' });
  if (today[0]) suggestions.push({ id: 'reflect', kind: 'reflect', entryId: today[0].id, title: '把刚读的内容变成自己的理解',
    reason: `围绕《${today[0].title}》，试着回答：解决了什么问题，关键假设是什么，还有哪里不确定？`, label: '和助手复盘' });
  suggestions.push({ id: 'recommendations', kind: 'recommendations', title: today.length ? '看看相近方向的新论文' : '从今日推荐里选一篇',
    reason: '根据近期阅读论文的标签，从 arXiv 找到可核查的新论文。', label: '查看论文推荐' });
  return { date, minutes, count: today.length, recent: recent.map(entry => ({ title: entry.title.slice(0, 240), tags: (entry.tags ?? []).slice(0, 8), minutes: Math.round((states[entry.id]?.total_active_ms ?? 0) / 60_000) })), candidates: suggestions };
}

export function parseDailyAdvice(value: unknown, input: DailyAdviceInput) {
  const result = value as { summary?: unknown; suggestions?: unknown } | null;
  if (!result || typeof result.summary !== 'string' || !result.summary.trim() || !Array.isArray(result.suggestions)) throw new Error('建议格式不完整');
  const seen = new Set<string>();
  const suggestions = result.suggestions.flatMap((row: unknown) => {
    const item = row as { id?: unknown; reason?: unknown } | null;
    const candidate = input.candidates.find(c => c.id === item?.id);
    if (!candidate || seen.has(candidate.id)) return [];
    seen.add(candidate.id);
    return [{ ...candidate, reason: typeof item?.reason === 'string' && item.reason.trim() ? item.reason.trim().slice(0, 220) : candidate.reason }];
  }).slice(0, 3);
  if (!suggestions.length) throw new Error('没有可用的建议');
  return { summary: result.summary.trim().slice(0, 300), suggestions };
}

