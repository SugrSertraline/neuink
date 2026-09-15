import { Minus, Plus, RotateCcw, Type } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  REFLOW_BACKGROUND_COLOR_DEFAULT,
  REFLOW_FONT_SIZE_DEFAULT,
  REFLOW_FONT_SIZE_MAX,
  REFLOW_FONT_SIZE_MIN,
  normalizeReflowFontSize,
  type ReaderPreferences
} from '@/shared/lib/readerPreferences';

const BACKGROUND_PRESETS = [
  { color: '#ffffff', label: '白色' },
  { color: '#fff8ed', label: '暖白' },
  { color: '#f2f8f3', label: '浅绿' },
  { color: '#f3f4f6', label: '浅灰' }
] as const;

export function ReflowAppearanceControls({
  preferences,
  onChange,
  compact = false
}: {
  preferences: ReaderPreferences;
  onChange: (preferences: ReaderPreferences) => void;
  compact?: boolean;
}) {
  const updateFontSize = (value: number) => {
    onChange({ ...preferences, reflowFontSize: normalizeReflowFontSize(value) });
  };

  const resetAppearance = () => {
    onChange({
      ...preferences,
      reflowBackgroundColor: REFLOW_BACKGROUND_COLOR_DEFAULT,
      reflowFontSize: REFLOW_FONT_SIZE_DEFAULT
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label="重排阅读外观"
          className={cn('gap-1.5 px-2', !compact && 'h-8')}
          size="sm"
          title="调整重排视图的文字大小和背景颜色"
          type="button"
          variant="outline"
        >
          {compact ? <span>字号</span> : <Type size={14} aria-hidden="true" />}
          <span className="tabular-nums">{preferences.reflowFontSize}</span>
          <span
            aria-hidden="true"
            className="size-3 rounded-full border border-border shadow-inner"
            style={{ backgroundColor: preferences.reflowBackgroundColor }}
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 space-y-4 p-4" sideOffset={8}>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium">文字大小</label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {preferences.reflowFontSize} px
            </span>
          </div>
          <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2">
            <Button
              aria-label="减小重排文字"
              className="size-8 p-0"
              disabled={preferences.reflowFontSize <= REFLOW_FONT_SIZE_MIN}
              size="icon"
              type="button"
              variant="outline"
              onClick={() => updateFontSize(preferences.reflowFontSize - 1)}
            >
              <Minus size={14} aria-hidden="true" />
            </Button>
            <input
              aria-label="重排文字大小"
              className="w-full cursor-pointer accent-primary"
              max={REFLOW_FONT_SIZE_MAX}
              min={REFLOW_FONT_SIZE_MIN}
              step={1}
              type="range"
              value={preferences.reflowFontSize}
              onChange={(event) => updateFontSize(Number(event.target.value))}
            />
            <Button
              aria-label="增大重排文字"
              className="size-8 p-0"
              disabled={preferences.reflowFontSize >= REFLOW_FONT_SIZE_MAX}
              size="icon"
              type="button"
              variant="outline"
              onClick={() => updateFontSize(preferences.reflowFontSize + 1)}
            >
              <Plus size={14} aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium" htmlFor="reflow-background-color">
              背景颜色
            </label>
            <span className="font-mono text-xs uppercase text-muted-foreground">
              {preferences.reflowBackgroundColor}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {BACKGROUND_PRESETS.map((preset) => (
              <button
                aria-label={`使用${preset.label}背景`}
                className={cn(
                  'size-7 rounded-full border shadow-sm outline-none ring-offset-2 transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring',
                  preferences.reflowBackgroundColor === preset.color && 'ring-2 ring-primary'
                )}
                key={preset.color}
                style={{ backgroundColor: preset.color }}
                title={preset.label}
                type="button"
                onClick={() => onChange({ ...preferences, reflowBackgroundColor: preset.color })}
              />
            ))}
            <label
              className="relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-md border bg-background text-[10px] text-muted-foreground hover:bg-muted"
              htmlFor="reflow-background-color"
              title="选择自定义颜色"
            >
              自定
              <input
                aria-label="自定义重排背景颜色"
                className="absolute inset-0 cursor-pointer opacity-0"
                id="reflow-background-color"
                type="color"
                value={preferences.reflowBackgroundColor}
                onChange={(event) =>
                  onChange({ ...preferences, reflowBackgroundColor: event.target.value })
                }
              />
            </label>
          </div>
        </div>

        <Button
          className="w-full gap-2"
          size="sm"
          type="button"
          variant="ghost"
          onClick={resetAppearance}
        >
          <RotateCcw size={13} aria-hidden="true" />
          恢复默认外观
        </Button>
      </PopoverContent>
    </Popover>
  );
}
