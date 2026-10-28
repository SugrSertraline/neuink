import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ReadingTrendChart } from './ReadingTrendChart';
import { DailyReadPapers } from './DailyReadPapers';
import { useDaily } from './DailyContext';
import { RecommendationPanel } from './RecommendationPanel';
import { useLibraryReadingStates } from '@/modules/reader/useLibraryReadingStates';
import { buildReadingOverview, formatLocalDate, formatReadingDuration } from '@/modules/reader/components/libraryReading';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { EntryReadingState } from '@/shared/types/domain';

type DashboardProps = {
  active?: boolean;
  entries: LibraryEntry[];
  onOpenEntry: (id: string) => void;
  onOpenLibrary: () => void;
};

export function DailyDashboard({ root, status, onRefreshCatalog, ...props }: DashboardProps & {
  root: string | null;
  status: 'ready' | 'loading' | 'error';
  onRefreshCatalog: () => void;
}) {
  const reading = useLibraryReadingStates(root, status === 'ready');
  return <DailyDashboardView {...props}
    states={reading.states}
    loading={status === 'loading' || reading.loading}
    error={status === 'error' ? '资料库读取失败，无法统计阅读时长。' : reading.error ? '阅读记录读取失败，请重试。' : !root ? '请先打开资料库，再查看每日阅读记录。' : null}
    onRetry={() => { reading.refresh(); if (status === 'error') onRefreshCatalog(); }} />;
}

/** Dates and scrolling belong to this view; reading activity stays with the reader. */
export function DailyDashboardView({ active = true, entries, states, loading, error, onRetry, onOpenEntry, onOpenLibrary }: DashboardProps & {
  states: Record<string, EntryReadingState>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [today, setToday] = useState(() => formatLocalDate(new Date()));
  const [chosenDate, setChosenDate] = useState<string | null>(null);
  const daily = useDaily();
  const date = daily?.date ?? chosenDate ?? today;
  useEffect(() => {
    const update = () => setToday(formatLocalDate(new Date()));
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  const overview = useMemo(() => buildReadingOverview(entries, states, new Date(`${date}T12:00:00`)), [entries, states, date]);
  const papers = useMemo(() => entries.flatMap(entry => {
    const state = states[entry.id];
    const duration = state?.daily_active_ms[date] ?? 0;
    return duration > 0 ? [{ entry, state, duration }] : [];
  }).sort((a, b) => b.duration - a.duration || a.entry.title.localeCompare(b.entry.title)), [entries, states, date]);
  const selectDate = (value: string) => {
    if (daily) { daily.selectDate(value); return; }
    const parsed = new Date(`${value}T12:00:00`);
    if (!Number.isNaN(parsed.getTime()) && formatLocalDate(parsed) === value && value <= today) setChosenDate(value === today ? null : value);
  };
  const step = (delta: number) => {
    const next = new Date(`${date}T12:00:00`);
    next.setDate(next.getDate() + delta);
    selectDate(formatLocalDate(next));
  };
  const ready = !loading && !error;
  return <section aria-label="每日看板" className="flex h-full min-h-0 min-w-0 flex-col bg-card text-foreground @container/daily">
    <header className="flex shrink-0 flex-wrap items-center gap-2 px-5 py-3">
      <h1 className="mr-auto text-base font-semibold">每日看板</h1>
      <Button size="lg" className="px-4" onClick={onOpenLibrary}>打开条目库</Button>
      <div className="flex max-w-full flex-wrap items-center gap-1" role="group" aria-label="选择看板日期">
        <Button size="sm" variant="ghost" aria-label="前一天" title="前一天" onClick={() => step(-1)}><ChevronLeft size={14} /></Button>
        <Input type="date" aria-label="看板日期" className="h-7 w-36 text-xs" max={today} value={date} onChange={event => selectDate(event.target.value)} />
        <Button size="sm" variant="ghost" aria-label="后一天" title="后一天" disabled={date >= today} onClick={() => step(1)}><ChevronRight size={14} /></Button>
        <Button size="sm" variant="outline" disabled={date === today} onClick={() => daily ? daily.selectDate(today) : setChosenDate(null)}>今天</Button>
      </div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]" role="region" aria-label="每日看板内容" tabIndex={0}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 pb-5 pt-1">
        {ready ? <DailyReadPapers key={date} papers={papers} hasEntries={entries.length > 0} onOpenEntry={onOpenEntry} onOpenLibrary={onOpenLibrary} /> : null}
        <section className="min-w-0 space-y-4" aria-label="阅读统计">
        {loading ? <p role="status" className="text-sm text-muted-foreground">正在读取阅读记录…</p> : null}
        {error && !loading ? <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <p>{error}</p><Button size="sm" variant="outline" onClick={onRetry}>重试</Button>
        </div> : null}
        {ready ? <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @min-[600px]/daily:grid-cols-4" aria-label="阅读汇总">
            <Metric label={date === today ? '今日阅读' : '当日阅读'} value={formatReadingDuration(overview.todayMs)} />
            <Metric label="当日阅读论文" value={`${papers.length} 篇`} />
            <Metric label="近 7 天阅读" value={formatReadingDuration(overview.weekMs)} />
            <Metric label="累计阅读" value={formatReadingDuration(overview.totalMs)} />
          </dl>
          <ReadingTrendChart entries={entries} states={states} date={date} onSelectDate={selectDate} />
        </> : null}
        </section>
        <RecommendationPanel active={active && date === today} />
      </div>
    </div>
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd></div>;
}
