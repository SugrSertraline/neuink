import { useId, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useAppearance } from '@/shared/components/AppearanceProvider';
import { readingChartCeiling, readingDayLabel, readingCandleLabel, type ReadingChartMode, type ReadingDay } from './readingTrend';
import type { ChartHintAnchor } from './ReadingChartTooltip';
import { ReadingChartBead, ReadingChartMaterial, ReadingChartPrism } from './ReadingChartMaterial';

type PlotProps = {
  days: ReadingDay[]; mode: ReadingChartMode; date: string; inspected: string;
  onInspect: (key: string, source: 'pointer' | 'keyboard', anchor: ChartHintAnchor) => void; onSelectDate: (date: string) => void;
  preview?: boolean; hintId?: string;
};

function navigatePoints(event: KeyboardEvent<HTMLDivElement>, heatmap: boolean) {
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-chart-point]'));
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  const delta = { ArrowLeft: heatmap ? -7 : -1, ArrowRight: heatmap ? 7 : 1, ArrowUp: -1, ArrowDown: 1 }[event.key];
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : delta != null ? index + delta : null;
  if (next == null) return;
  event.preventDefault(); event.stopPropagation();
  buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
}

function Point({ label, active, selected, onInspect, onSelect, className = '', style, children, hintId, empty, intense }: {
  label: string; active: boolean; selected: boolean; onInspect: (source: 'pointer' | 'keyboard', anchor: ChartHintAnchor) => void; onSelect: () => void;
  className?: string; style?: CSSProperties; children?: ReactNode; hintId?: string; empty?: boolean; intense?: boolean;
}) {
  return <button type="button" data-chart-point tabIndex={active ? 0 : -1} aria-label={label} aria-pressed={selected}
    data-empty={empty || undefined} data-intense={intense || undefined}
    aria-describedby={active ? hintId : undefined} onMouseEnter={event => onInspect('pointer', { x: event.clientX, y: event.clientY })}
    onMouseMove={event => { if (!hintId) onInspect('pointer', { x: event.clientX, y: event.clientY }); }}
    onFocus={event => { if (event.currentTarget.matches(':focus-visible')) {
      const rect = event.currentTarget.getBoundingClientRect();
      onInspect('keyboard', { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    } }} onClick={onSelect} style={style}
    className={`min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${className}`}>
    {children}
  </button>;
}

export function ReadingTrendPlot({ days, mode, date, inspected, onInspect, onSelectDate, preview = false, hintId }: PlotProps) {
  const { appearance } = useAppearance();
  const dimensional = appearance === 'atelier';
  const materialId = `reading-material-${useId().replace(/:/g, '')}`;
  const height = preview ? 48 : 272;
  if (mode === 'heatmap') {
    const max = Math.max(1, ...days.map(day => day.activeMs));
    const leading = (new Date(`${days[0].date}T12:00:00`).getDay() + 6) % 7;
    const weeks = Math.ceil((days.length + leading) / 7);
    return <div>
      <div className="flex gap-2">
        {!preview && <div style={{ height }} className="grid w-7 shrink-0 grid-rows-7 items-center text-right text-[10px] text-muted-foreground" aria-hidden="true">
          {['一', '', '三', '', '五', '', '日'].map((label, index) => <span key={index}>{label}</span>)}
        </div>}
        <div className={`grid min-w-0 flex-1 grid-flow-col grid-rows-7 ${preview ? 'gap-0.5' : 'gap-1.5'}`} style={{ height, gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }} role={preview ? undefined : 'group'} aria-label={preview ? undefined : '每日阅读热力'} onKeyDown={preview ? undefined : event => navigatePoints(event, true)}>
          {Array.from({ length: leading }, (_, index) => <span key={`before-${index}`} aria-hidden="true" />)}
          {days.map(day => preview ? <span key={day.date} data-empty={!day.activeMs || undefined}
            className="reading-heatmap-cell relative overflow-hidden rounded-sm" style={{ '--reading-heat-value': day.activeMs / max } as CSSProperties}>
            <span className={`reading-heatmap-pigment absolute inset-0 ${day.activeMs ? 'bg-chart-1' : 'bg-muted'}`} style={{ opacity: day.activeMs ? 0.16 + 0.65 * day.activeMs / max : 1 }} />
          </span> : <Point key={day.date} label={readingDayLabel(day)} active={inspected === day.date} selected={date === day.date}
            empty={!day.activeMs} intense={day.activeMs / max > 0.65} style={{ '--reading-heat-value': day.activeMs / max } as CSSProperties}
            hintId={hintId} onInspect={(source, anchor) => onInspect(day.date, source, anchor)} onSelect={() => onSelectDate(day.date)}
            className={`reading-heatmap-cell relative overflow-hidden border ${date === day.date ? 'border-foreground' : 'border-transparent'}`}>
            <span aria-hidden="true" className={`reading-heatmap-pigment absolute inset-0 ${day.activeMs ? 'bg-chart-1' : 'bg-muted'}`} style={{ opacity: day.activeMs ? 0.16 + 0.65 * day.activeMs / max : 1 }} />
            <span aria-hidden="true" className="reading-heatmap-number relative block text-[10px] leading-none tabular-nums">{Number(day.date.slice(-2))}</span>
          </Point>)}
          {Array.from({ length: weeks * 7 - leading - days.length }, (_, index) => <span key={`after-${index}`} aria-hidden="true" />)}
        </div>
      </div>
      {!preview && <div className="ml-9 mt-2 flex justify-between text-xs text-muted-foreground" aria-hidden="true"><span>{days[0].label}</span><span>{days[days.length - 1].label}</span></div>}
    </div>;
  }
  const candle = mode === 'candle';
  const ceiling = readingChartCeiling(days, candle);
  const width = 840, top = 8, bottom = height - 8;
  const y = (value: number) => bottom - value / ceiling * (bottom - top);
  const count = days.length;
  const slot = width / count;
  const barWidth = Math.min(16, slot * 0.45);
  const depth = Math.min(preview ? 2 : 4, slot * 0.14);
  const x = (index: number) => slot * (index + 0.5);
  const first = days[0], last = days[days.length - 1];
  return <div>
    <div className="flex gap-2">
      {!preview && <div style={{ height }} aria-hidden="true" className="flex w-7 shrink-0 flex-col justify-between py-1 text-right text-[11px] tabular-nums text-muted-foreground">
        {[ceiling, ceiling / 2, 0].map(value => <span key={value}>{Number((value / 60_000).toFixed(1))}</span>)}
      </div>}
      <div className="min-w-0 flex-1">
        <div className="reading-plot-frame relative" style={{ height }}>
          <svg aria-hidden="true" className="reading-plot-svg pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
            {dimensional && <ReadingChartMaterial id={materialId} />}
            {!preview && [0, ceiling / 2, ceiling].map(value => <line key={value} x1={0} x2={width} y1={y(value)} y2={y(value)} stroke="var(--border)" strokeDasharray={value ? '3 5' : undefined} vectorEffect="non-scaling-stroke" />)}
            {dimensional && <path className="reading-chart-depth" d={`M0 ${bottom} H${width - depth} l${depth} ${-depth} H${depth} Z`}
              fill="var(--atelier-shadow-soft)" stroke="var(--atelier-control-edge)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />}
            <g filter={dimensional && mode !== 'line' ? `url(#${materialId}-shadow)` : undefined}>
            {mode === 'bar' ? days.map((day, index) => dimensional ? <ReadingChartPrism key={day.date} id={materialId}
              x={x(index) - barWidth / 2} y={y(day.activeMs)} width={barWidth} height={bottom - y(day.activeMs)} depth={depth} />
              : <rect key={day.date} x={x(index) - barWidth / 2} y={y(day.activeMs)} width={barWidth} height={bottom - y(day.activeMs)} rx={1} fill="var(--chart-1)" opacity={day.date === date ? 1 : 0.7} />) : null}
            {mode === 'line' ? <>
              <polygon points={`${x(0)},${bottom} ${days.map((day, index) => `${x(index)},${y(day.activeMs)}`).join(' ')} ${x(count - 1)},${bottom}`} fill={dimensional ? `url(#${materialId}-area)` : 'var(--chart-1)'} opacity={dimensional ? 1 : 0.07} />
              {dimensional && <polyline className="reading-chart-depth" points={days.map((day, index) => `${x(index)},${y(day.activeMs) + 2}`).join(' ')} fill="none"
                stroke="var(--atelier-chart-shadow)" strokeWidth={preview ? 2.5 : 4.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
              <polyline points={days.map((day, index) => `${x(index)},${y(day.activeMs)}`).join(' ')} fill="none" stroke="var(--chart-1)" strokeWidth={dimensional ? preview ? 2 : 3.5 : preview ? 1.5 : 2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {dimensional && <polyline className="reading-chart-depth" points={days.map((day, index) => `${x(index)},${y(day.activeMs) - 0.5}`).join(' ')} fill="none"
                stroke="var(--atelier-chart-highlight)" strokeOpacity="0.7" strokeWidth="0.7" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
              {!preview && days.map((day, index) => dimensional ? <ReadingChartBead key={day.date} id={materialId} x={x(index)} y={y(day.activeMs)} radius={Math.min(5, slot * 0.23)} active={day.date === inspected} />
                : <ellipse key={day.date} cx={x(index)} cy={y(day.activeMs)} rx={Math.min(4, slot * 0.2)} ry={day.date === inspected ? 3.5 : 2} fill="var(--chart-1)" />)}
            </> : null}
            {candle ? days.map((day, index) => {
              const values = day.candle;
              if (!values) return day.activeMs > 0 ? <line key={day.date} x1={x(index) - slot * 0.2} x2={x(index) + slot * 0.2} y1={bottom} y2={bottom} stroke="var(--muted-foreground)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" /> : null;
              const rising = values.close >= values.open;
              const color = rising ? 'var(--chart-1)' : 'var(--chart-3)';
              const bodyWidth = Math.min(32, slot * 0.5);
              return <g key={day.date}>
                <line x1={x(index)} x2={x(index)} y1={y(values.high)} y2={y(values.low)} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                {dimensional && <line className="reading-chart-depth" x1={x(index) - 0.5} x2={x(index) - 0.5} y1={y(values.high)} y2={y(values.low)} stroke="var(--atelier-chart-highlight)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />}
                {values.close === values.open ? <line x1={x(index) - bodyWidth / 2} x2={x(index) + bodyWidth / 2} y1={y(values.open)} y2={y(values.open)} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  : dimensional ? <ReadingChartPrism id={materialId} x={x(index) - bodyWidth / 2} y={y(Math.max(values.open, values.close))}
                    width={bodyWidth} height={Math.abs(y(values.open) - y(values.close))} depth={depth} tone={rising ? 'copper' : 'patina'} hollow={!rising} />
                  : <rect x={x(index) - bodyWidth / 2} y={y(Math.max(values.open, values.close))} width={bodyWidth} height={Math.abs(y(values.open) - y(values.close))}
                      fill={rising ? color : 'var(--card)'} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
              </g>;
            }) : null}
            </g>
          </svg>
          {!preview && <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }} role="group"
            aria-label={candle ? '每日阅读 K 线' : '每日阅读时长'} onKeyDown={event => navigatePoints(event, false)}>
            {days.map(day => <Point key={day.date} label={candle ? readingCandleLabel(day) : readingDayLabel(day)} active={inspected === day.date} selected={day.date === date}
              hintId={hintId} onInspect={(source, anchor) => onInspect(day.date, source, anchor)} onSelect={() => onSelectDate(day.date)} className="hover:bg-accent/30" />)}
          </div>}
        </div>
        {!preview && <div className="mt-2 flex justify-between gap-2 text-[11px] text-muted-foreground" aria-hidden="true">
          <span>{first.label}</span><span>{last.label}</span>
        </div>}
      </div>
    </div>
  </div>;
}
