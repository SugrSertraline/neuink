import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { EntryReadingState } from '@/shared/types/domain';
import { buildReadingTrend, formatSessionDuration, READING_CHART_MODES, type ReadingChartMode } from './readingTrend';
import { formatReadingDuration } from '@/modules/reader/components/libraryReading';
import { ReadingChartTooltip, type ChartHintAnchor, type ChartTooltipHandle } from './ReadingChartTooltip';
import { ReadingTrendPlot } from './ReadingTrendPlot';
import { useReadingTrendZoom } from './useReadingTrendZoom';
import { useReadingChartSwap } from './useReadingChartSwap';
import { Button } from '@/components/ui/button';

const descriptions: Record<ReadingChartMode, string> = {
  bar: '每天的累计阅读时长，比较投入多少。',
  line: '同一份每日总时长，观察近期的起伏。',
  heatmap: '颜色越深，阅读越久；空白表示没有阅读。',
  candle: '首段开盘、末段收盘；影线为当天最长与最短一段。',
};
const previewDescriptions: Record<ReadingChartMode, string> = {
  bar: '每日累计时长', line: '每日时长变化', heatmap: '深色表示读得久', candle: '首末段与最长最短',
};

/** Each chart retains its own range; only the primary plot owns zoom, the dashboard owns scrolling. */
export function ReadingTrendChart({ entries, states, date, onSelectDate }: {
  entries: LibraryEntry[]; states: Record<string, EntryReadingState>; date: string; onSelectDate: (date: string) => void;
}) {
  const swap = useReadingChartSwap();
  const zoom = useReadingTrendZoom(swap.primary);
  const modes = Object.keys(READING_CHART_MODES) as ReadingChartMode[];
  const previews = modes.filter(mode => mode !== swap.primary);
  const [inspected, setInspected] = useState(date);
  const [hint, setHint] = useState<{ mode: ReadingChartMode; date: string; source: 'pointer' | 'keyboard'; anchor: ChartHintAnchor } | null>(null);
  const tooltipRef = useRef<ChartTooltipHandle>(null);
  const hintId = useId();
  useEffect(() => {
    if (!hint) return;
    const hide = () => setHint(null);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [Boolean(hint)]);
  const trends = useMemo(() => {
    const ids = entries.map(entry => entry.id);
    return {
      bar: buildReadingTrend(ids, states, date, zoom.daysByMode.bar),
      line: buildReadingTrend(ids, states, date, zoom.daysByMode.line),
      heatmap: buildReadingTrend(ids, states, date, zoom.daysByMode.heatmap),
      candle: buildReadingTrend(ids, states, date, zoom.daysByMode.candle),
    };
  }, [entries, states, date, zoom.daysByMode]);
  const trend = trends[swap.primary];
  const day = trend.days.find(item => item.date === inspected) ?? trend.days[trend.days.length - 1];
  const showHint = hint?.mode === swap.primary && hint.date === day.date;
  const inspect = (key: string, source: 'pointer' | 'keyboard', anchor: ChartHintAnchor) => {
    setInspected(key); setHint({ mode: swap.primary, date: key, source, anchor });
  };
  return <section aria-label="阅读时长趋势" className="min-w-0 @container/trends">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-medium">阅读趋势</h2>
      <span className="text-xs tabular-nums text-muted-foreground" aria-label="阅读图表范围">近 {zoom.days} 天 · {trend.days[0].label} — {trend.days[trend.days.length - 1].label}</span>
    </div>
    <div ref={zoom.rootRef} data-reading-chart-grid className="relative mt-3 grid grid-cols-[minmax(0,3fr)_minmax(0,1fr)] gap-2 @min-[600px]/trends:gap-3"
      onMouseMove={event => { if (hint?.source === 'pointer') tooltipRef.current?.move({ x: event.clientX, y: event.clientY }); }}
      onMouseLeave={() => setHint(null)} onWheelCapture={() => setHint(null)}>
      {modes.map(mode => {
        const primary = mode === swap.primary;
        const label = READING_CHART_MODES[mode];
        return <section key={mode} ref={node => swap.register(mode, node)} aria-label={label} data-primary-chart={primary || undefined}
          style={{ gridColumn: primary ? 1 : 2, gridRow: primary ? '1 / span 3' : previews.indexOf(mode) + 1 }}
          className={`reading-chart-tile min-w-0 rounded-lg border bg-card ${primary ? 'z-10 flex flex-col p-3 @min-[600px]/trends:p-4' : 'z-20'}`}>
          {primary ? <>
            <h3 className="reading-chart-title mb-4 text-sm font-medium">{label}</h3>
            <div data-reading-zoom className="relative min-h-0 overflow-hidden" onMouseLeave={() => setHint(null)}
              onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setHint(null); }}
              onKeyDown={event => {
                if (event.key === 'Escape') { setHint(null); event.stopPropagation(); }
                else zoom.onKeyDown(event);
              }}>
              <ReadingTrendPlot {...trend} mode={mode} date={date} inspected={day.date} onInspect={inspect} onSelectDate={onSelectDate} hintId={showHint ? hintId : undefined} />
              {trend.days.every(item => item.activeMs === 0) ? <p className="pointer-events-none absolute inset-x-4 top-1/2 text-center text-xs text-muted-foreground">这个时间范围内还没有阅读记录。</p> : null}
            </div>
          </> : <Button variant="plain" aria-label={`放大查看${label}`} aria-describedby={hint?.mode === mode ? `${hintId}-${mode}` : undefined}
            onClick={() => { setHint(null); swap.select(mode); }}
            onMouseEnter={event => setHint({ mode, date: '', source: 'pointer', anchor: { x: event.clientX, y: event.clientY } })} onMouseLeave={() => setHint(null)}
            onMouseMove={event => { if (hint?.mode !== mode) setHint({ mode, date: '', source: 'pointer', anchor: { x: event.clientX, y: event.clientY } }); }}
            onFocus={event => { if (event.currentTarget.matches(':focus-visible')) {
              const rect = event.currentTarget.getBoundingClientRect();
              setHint({ mode, date: '', source: 'keyboard', anchor: { x: rect.left, y: rect.top + rect.height / 2 } });
            } }} onBlur={() => setHint(null)}
            onKeyDown={event => { if (event.key === 'Escape') { setHint(null); event.stopPropagation(); } }}
            className="reading-chart-preview relative block h-full w-full min-w-0 whitespace-normal rounded-lg p-2 text-left text-foreground hover:bg-muted/60 @min-[600px]/trends:p-3">
            <span className="reading-chart-title mb-2 block text-xs font-medium">{label}</span>
            <div aria-hidden="true" className="pointer-events-none"><ReadingTrendPlot {...trends[mode]} mode={mode} date={date} inspected={day.date} onInspect={setInspected} onSelectDate={onSelectDate} preview /></div>
          </Button>}
        </section>;
      })}
      {hint && (showHint || hint.mode !== swap.primary) ? <ReadingChartTooltip ref={tooltipRef} containerRef={zoom.rootRef}
        id={showHint ? hintId : `${hintId}-${hint.mode}`} anchor={hint.anchor}>
        {showHint ? <>
          <p className="mb-1.5 font-medium tabular-nums">{day.date}</p>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-muted-foreground"><span className="size-1.5 rounded-full bg-chart-1" />阅读时长</span>
            <strong className="font-semibold tabular-nums">{formatReadingDuration(day.activeMs)}</strong>
          </div>
          {hint.mode === 'candle' ? day.candle ? <dl className="mt-2 space-y-0.5 border-t pt-2 tabular-nums" aria-label="当日分段详情">
            {([['开盘 · 首段', day.candle.open], ['收盘 · 末段', day.candle.close], ['最高 · 最长', day.candle.high], ['最低 · 最短', day.candle.low]] as const).map(([label, value]) =>
              <div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd>{formatSessionDuration(value)}</dd></div>)}
          </dl> : day.activeMs > 0 ? <p className="mt-2 text-[11px] text-muted-foreground">分段记录不完整，保留每日总时长，不推算 K 线。</p> : null : null}
          <p className="mt-2 border-t pt-1.5 text-[10px] leading-4 text-muted-foreground">{descriptions[hint.mode]}</p>
        </> : <><p className="font-medium">{READING_CHART_MODES[hint.mode]}</p><p className="mt-1 text-[11px] text-muted-foreground">{previewDescriptions[hint.mode]}</p></>}
      </ReadingChartTooltip> : null}
    </div>
  </section>;
}
