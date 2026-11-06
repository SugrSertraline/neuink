import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLibraryReadingStates } from '@/modules/reader/useLibraryReadingStates';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { useDaily } from './DailyContext';
import { useRecommendations } from './RecommendationContext';
import { buildDailyAdvice, type DailySuggestion } from './dailyAdvice';
import { useDailyAdvice } from './useDailyAdvice';
import { DailyFoodPicker } from './DailyFoodPicker';
import { FoodMenuDialog } from './FoodMenuDialog';
import { DailySidebarSettings } from './DailySidebarSettings';
import { type DailySidebarPreferences } from './dailyLifestyle';
import { useDailyHoroscope } from './useDailyHoroscope';
import { useDailySidebarPreferences } from './useDailySidebarPreferences';

const DailyCalendar = lazy(() => import('./DailyCalendar'));

export function DailySidebar({ active = false, entries = [], status = 'ready', onOpenEntry, onOpenRecommendations, onReflect, onSettings }: {
  active?: boolean; entries?: LibraryEntry[]; status?: 'ready' | 'loading' | 'error';
  onOpenEntry?: (id: string) => void; onOpenRecommendations?: () => void;
  onReflect?: (entry: LibraryEntry) => void; onSettings?: () => void;
}) {
  const daily = useDaily()!, recommendations = useRecommendations();
  const { preferences, update, saveError } = useDailySidebarPreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showAdvice = !preferences.hidden.includes('advice');
  const reading = useLibraryReadingStates(daily.root, active && status === 'ready' && showAdvice);
  const input = useMemo(() => buildDailyAdvice(entries, reading.states, daily.today), [entries, reading.states, daily.today]);
  const ready = Boolean(daily.root && status === 'ready' && !reading.loading && !reading.error);
  const advice = useDailyAdvice(active && showAdvice, ready, input, daily.root);
  useEffect(() => { if (active) recommendations?.ensureToday(); }, [active, recommendations?.ensureToday]);
  useEffect(() => { if (!active) { setSettingsOpen(false); setMenuOpen(false); } }, [active]);
  const suggestions = advice.phase === 'ready' ? advice.result!.suggestions : input.candidates.slice(0, 3);
  const [first, ...others] = suggestions;
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${daily.today}T12:00:00`));
  const run = (suggestion: DailySuggestion) => {
    const entry = entries.find(item => item.id === suggestion.entryId);
    if (suggestion.kind === 'read' && entry) onOpenEntry?.(entry.id);
    if (suggestion.kind === 'reflect' && entry) onReflect?.(entry);
    if (suggestion.kind === 'recommendations') onOpenRecommendations?.();
  };
  const readingAdvice = <div className="mt-4">
      {!daily.root ? <p className="text-xs text-muted-foreground">打开资料库后，按当天阅读情况为你推荐下一步。</p>
        : status === 'loading' || reading.loading ? <p role="status" className="text-xs">正在了解今天的阅读情况…</p>
        : status === 'error' || reading.error ? <p role="alert" className="text-xs text-destructive">暂时无法读取阅读记录。<Button size="xs" variant="ghost" onClick={reading.refresh}>重试</Button></p>
        : <>
          <p className="mt-2 break-words text-sm font-medium leading-relaxed">{advice.phase === 'ready' ? advice.result!.summary : input.count ? '把今天的阅读再推进一步。' : '从一篇论文、一个小问题开始。'}</p>
          <p className="mt-2 text-xs text-muted-foreground" aria-label="今日阅读情况">今天已读 <span className="font-medium tabular-nums text-foreground">{input.count}</span> 篇<span aria-hidden="true" className="px-2">·</span><span className="font-medium tabular-nums text-foreground">{input.minutes}</span> 分钟</p>
          {first ? <section aria-label="首选建议" className="mt-5 min-w-0 rounded-lg bg-primary/5 p-3">
            <p className="text-[11px] font-medium text-primary">建议先做 · {suggestionKindLabel(first.kind)}</p>
            <h3 className="mt-2 break-words text-sm font-semibold leading-relaxed">{first.title}</h3>
            <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">{first.reason}</p>
            <Button size="sm" className="mt-3" onClick={() => run(first)}>{first.label}<ArrowUpRight aria-hidden="true" /></Button>
          </section> : null}
          {others.length ? <div className="mt-5">
            <p className="text-[11px] text-muted-foreground">也可以</p>
            <ul className="mt-2 space-y-4">{others.map(suggestion => <li key={suggestion.id} className="min-w-0">
              <h3 className="break-words text-[13px] font-medium leading-relaxed">{suggestion.title}</h3>
              <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{suggestion.reason}</p>
              <Button size="xs" variant="link" className="mt-1.5 h-auto min-h-6 px-0" onClick={() => run(suggestion)}>{suggestion.label}<ArrowUpRight aria-hidden="true" /></Button>
            </li>)}</ul>
          </div> : null}
        </>}
      </div>;
  return <aside className="app-sidebar daily-sidebar flex min-h-0 flex-col" aria-label="每日智能建议">
    <div className="side-head flex h-9 shrink-0 items-center gap-2"><span className="mr-auto font-semibold">每日推荐</span>
      {showAdvice && <Button size="icon-xs" variant="plain" aria-label="刷新每日建议" title={advice.error || '刷新每日建议'} aria-busy={advice.phase === 'loading'} disabled={!ready || advice.phase === 'loading'} onClick={advice.refresh}>
        <RefreshCw aria-hidden="true" className={advice.phase === 'loading' ? 'motion-safe:animate-spin' : ''} />
      </Button>}
      <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
        <PopoverTrigger asChild><Button size="icon-xs" variant="plain" aria-label="每日推荐显示设置" title="每日推荐显示设置"><Settings2 aria-hidden="true" /></Button></PopoverTrigger>
        <PopoverContent align="end" viewportAligned className="max-h-[min(75vh,36rem)] w-[min(23rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain" aria-label="每日推荐显示设置">
          <DailySidebarSettings preferences={preferences} update={update} />
          {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
        </PopoverContent>
      </Popover>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3">
      <time dateTime={daily.today} className="text-xs text-muted-foreground">{dateLabel}</time>
      {preferences.order.filter(section => !preferences.hidden.includes(section)).map(section => {
        if (section === 'calendar') return <Suspense key={section} fallback={<p role="status" className="mt-3 text-xs text-muted-foreground">正在读取节令…</p>}>
          {active && <DailyCalendar date={daily.today} />}
        </Suspense>;
        if (section === 'meal') return <DailyFoodPicker key={section} active={active} date={daily.today} preferences={preferences} update={update} onSettings={() => setMenuOpen(true)} />;
        if (section === 'horoscope') return <DailyHoroscope key={section} active={active} date={daily.today} preferences={preferences} onSettings={onSettings} />;
        return <div key={section}>{readingAdvice}</div>;
      })}
      {preferences.hidden.length === preferences.order.length && <p className="mt-4 text-xs text-muted-foreground">当前没有显示内容，可在右上角设置中开启。</p>}
    </div>
    {menuOpen && <FoodMenuDialog preferences={preferences} save={update} onClose={() => setMenuOpen(false)} />}
  </aside>;
}

function DailyHoroscope({ active, date, preferences, onSettings }: {
  active: boolean; date: string; preferences: DailySidebarPreferences; onSettings?: () => void;
}) {
  const fortune = useDailyHoroscope(active, date, preferences.zodiac);
  return <section aria-label="星座运势" className="space-y-2 border-b border-border py-3 text-xs">
    <div className="flex items-center justify-between gap-2"><h3 className="font-medium">星座运势</h3><span className="text-[10px] text-muted-foreground">{preferences.zodiac || '联网查询'}</span></div>
    {!preferences.zodiac ? <p className="text-muted-foreground">在设置中选好星座后，查看每天的联网运势。</p>
      : fortune.phase === 'ready' && fortune.data ? <div className="space-y-1.5 break-words leading-relaxed">
        <p>{fortune.data.summary}</p>
        <p><span className="text-muted-foreground">学习工作：</span>{fortune.data.work}</p>
        {fortune.data.suitable && <p><span className="text-muted-foreground">宜：</span>{fortune.data.suitable}</p>}
        {fortune.data.avoid && <p><span className="text-muted-foreground">忌：</span>{fortune.data.avoid}</p>}
      </div> : fortune.phase === 'error' ? <div role="alert" className="text-muted-foreground">联网运势暂不可用。
        <Button size="xs" variant="link" className="h-auto px-1" onClick={fortune.refresh}>重试</Button></div>
      : <p role="status" className="text-muted-foreground">正在获取今日运势…</p>}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {onSettings && <Button size="xs" variant="link" className="h-auto px-0" onClick={onSettings}>{preferences.zodiac ? '更改星座' : '去设置星座'}</Button>}
      {fortune.phase === 'ready' && <Button size="xs" variant="link" className="h-auto px-0" onClick={fortune.refresh}>刷新运势</Button>}
    </div>
    <p className="text-[10px] text-muted-foreground">来源：爱云 API · 仅供娱乐参考。</p>
  </section>;
}

function suggestionKindLabel(kind: DailySuggestion['kind']) {
  return { read: '阅读', reflect: '复盘', recommendations: '发现论文' }[kind];
}

