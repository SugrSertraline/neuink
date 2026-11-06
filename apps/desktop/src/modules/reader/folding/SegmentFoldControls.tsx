import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { FOLD_LEVELS } from './FoldControls';
import type { FoldLevel } from './useFoldReader';
import { FOLD_GESTURE_HINT } from './useFoldLevelGesture';

type SegmentFoldValue = FoldLevel | 'inherit';

export function SegmentFoldControls({ value, globalLevel, eligible, available, onChange, onInteraction }: {
  value: SegmentFoldValue; globalLevel: FoldLevel; eligible: boolean; available: boolean;
  onChange: (value: SegmentFoldValue) => void; onInteraction: () => void;
}) {
  const hint = available ? FOLD_GESTURE_HINT : eligible
    ? '本段尚未生成阅读详略，当前显示原文。请点击顶部“生成详略”，选择本段后生成。'
    : '此段不适合生成阅读详略，保留原文。';
  const itemClassName = `h-full min-w-0 px-2 text-[11px] ${available
    ? 'data-[state=on]:bg-accent data-[state=on]:text-accent-foreground'
    : 'data-[state=on]:bg-muted data-[state=on]:text-foreground'}`;
  // Keep unavailable results neutral even when an appearance preset colors selected controls.
  const itemStyle = available ? undefined : { color: 'var(--foreground)' };
  return <Tooltip>
    <TooltipTrigger asChild><div className="reflow-segment-fold-tabs h-6 shrink-0">
    <ToggleGroup type="single" size="sm" spacing={0} value={value} aria-label="本段阅读详略" aria-description={hint}
    className="grid h-6 grid-cols-6 rounded-md border border-border bg-background text-foreground"
    onValueChange={next => { if (next) { onInteraction(); onChange(next as SegmentFoldValue); } }}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onMouseMove={event => { event.stopPropagation(); onInteraction(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.closest('section')?.focus(); }
    }}>
    <ToggleGroupItem value="inherit" aria-label="跟随全局" aria-description={`跟随全局：${FOLD_LEVELS.find(item => item.value === globalLevel)?.label}；${hint}`}
      className={itemClassName} style={itemStyle}>跟随</ToggleGroupItem>
    {FOLD_LEVELS.map(item => <ToggleGroupItem key={item.value} value={item.value}
      aria-label={item.label} disabled={!eligible && item.value !== 'full'}
      aria-description={hint} className={itemClassName} style={itemStyle}>{item.label}</ToggleGroupItem>)}
    </ToggleGroup>
    </div></TooltipTrigger>
    <TooltipContent side="top">{hint}</TooltipContent>
  </Tooltip>;
}
