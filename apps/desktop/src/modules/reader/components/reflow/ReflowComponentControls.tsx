import { useRef, useState } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { ReflowContentControls } from './ReflowContentControls';
import { resolveReflowContent, type ReflowComponentKey, type ReflowContentOverrides } from '@/shared/lib/reflowContentPreferences';
import {
  DEFAULT_REFLOW_COMPONENT_PREFERENCES,
  reflowTextSizeScale, reflowVisualSizeScale,
  type ReaderPreferences,
  type ReflowComponentPreferences,
  type ReflowComponentTextSize,
  type ReflowVisualSize
} from '@/shared/lib/readerPreferences';

const TEXT_COMPONENTS = [
  { key: 'heading', label: '标题' },
  { key: 'paragraph', label: '正文' },
  { key: 'list', label: '列表' },
  { key: 'table', label: '表格' },
  { key: 'math', label: '公式' },
  { key: 'code', label: '代码' },
  { key: 'supportingText', label: '脚注与边注' }
] as const;

const VISUAL_COMPONENTS = [
  { key: 'figure', label: '图片' },
  { key: 'chart', label: '解析图表' }
] as const;

export function ReflowComponentControls({
  preferences,
  onChange,
  onTranslationViewChange,
  getReadingBoundary
}: {
  getReadingBoundary?: () => HTMLElement | null;
  preferences: ReaderPreferences;
  onChange: (preferences: ReaderPreferences) => void;
  onTranslationViewChange?: (view: 'paragraph' | 'sentences') => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [boundary, setBoundary] = useState<HTMLElement | null>(null);
  const components = preferences.reflowComponents;
  const updateComponents = (next: ReflowComponentPreferences) => {
    onChange({ ...preferences, reflowComponents: next });
  };
  const updateContent = (key: ReflowComponentKey, patch: ReflowContentOverrides) => {
    if (patch.translationView) onTranslationViewChange?.(patch.translationView);
    updateComponents({ ...components, content: { ...components.content, [key]: { ...components.content?.[key], ...patch } } });
  };
  const contentControls = (key: ReflowComponentKey, label: string) => <ReflowContentControls component={key} label={label}
    showTranslationView={false} disabled={!components[key].visible}
    value={resolveReflowContent(key, preferences.reflowTranslationMode, components.content?.[key])}
    onChange={patch => updateContent(key, patch)} />;

  return (
    <Popover onOpenChange={open => {
      if (open) setBoundary(getReadingBoundary?.() ?? triggerRef.current?.closest<HTMLElement>('[data-guide="reflow-reader"]') ?? null);
    }}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          aria-label="重排组件设置"
          className="h-8 gap-1.5 px-2"
          size="sm"
          title="分别设置重排视图中的内容组件"
          type="button"
          variant="outline"
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          组件
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        viewportAligned
        collisionBoundary={boundary}
        collisionPadding={8}
        sticky="always"
        className="flex w-[22rem] max-w-[var(--radix-popover-content-available-width)] max-h-[min(36rem,var(--radix-popover-content-available-height))] flex-col gap-0 overflow-hidden p-0"
        sideOffset={8}
      >
        <div className="shrink-0 border-b border-border/50 px-4 py-4">
          <div className="text-sm font-semibold">阅读组件设置</div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            设置全局默认；悬停正文可单独调整，选“跟随”恢复。
          </p>
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/50 bg-muted/20 px-4 py-4">
            <div><div className="text-sm font-medium">正文对照方式</div>
              <p className="mt-1 text-xs text-muted-foreground">关闭为整段 · 单段设置优先</p></div>
            <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
              逐句对照
              <Switch aria-label="正文逐句对照"
                checked={resolveReflowContent('paragraph', preferences.reflowTranslationMode, components.content?.paragraph).translationView === 'sentences'}
                onCheckedChange={checked => updateContent('paragraph', { translationView: checked ? 'sentences' : 'paragraph' })} />
            </label>
          </div>
          <details className="border-b border-border/50 px-4 py-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">原图、解析后内容与翻译有什么区别？</summary>
            <p className="mt-2 pb-1 leading-relaxed">原图是 PDF 截图，解析后内容是可选字的重排原文，翻译是已有译文。切换显示不会重新翻译。</p>
          </details>
          <div className="divide-y divide-border/40">
          {TEXT_COMPONENTS.map(({ key, label }) => (
            <div key={key} className="grid gap-4 px-4 py-5"><ComponentRow label={label}>
              <Switch
                title={`总开关：显示或隐藏整个${label}组件`}
                aria-label={`显示${label}`}
                checked={components[key].visible}
                onCheckedChange={(visible) =>
                  updateComponents({
                    ...components,
                    [key]: { ...components[key], visible }
                  })
                }
              />
              <TextSizeSlider
                disabled={!components[key].visible}
                label={label}
                value={components[key].size}
                onChange={(size) =>
                  updateComponents({
                    ...components,
                    [key]: { ...components[key], size }
                  })
                }
              />
            </ComponentRow>{contentControls(key, label)}</div>
          ))}

          {VISUAL_COMPONENTS.map(({ key, label }) => (
            <div key={key} className="grid gap-4 px-4 py-5"><ComponentRow label={label}>
              <Switch
                title={`总开关：显示或隐藏整个${label}组件`}
                aria-label={`显示${label}`}
                checked={components[key].visible}
                onCheckedChange={(visible) =>
                  updateComponents({
                    ...components,
                    [key]: { ...components[key], visible }
                  })
                }
              />
              <VisualSizeSlider
                disabled={!components[key].visible}
                label={label}
                value={components[key].size}
                onChange={(size) =>
                  updateComponents({
                    ...components,
                    [key]: { ...components[key], size }
                  })
                }
              />
            </ComponentRow>{contentControls(key, label)}</div>
          ))}

          </div>
          <div className="border-t border-border/50 px-4 py-4"><ComponentRow label="点击图片查看详情">
            <Switch
              aria-label="点击图片查看详情"
              checked={components.imageClickToOpen}
              onCheckedChange={(imageClickToOpen) =>
                updateComponents({ ...components, imageClickToOpen })
              }
            />
          </ComponentRow></div>
        </div>

        <div className="shrink-0 border-t border-border/50 px-4 py-3">
          <Button
            className="w-full gap-2"
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => updateComponents(DEFAULT_REFLOW_COMPONENT_PREFERENCES)}
          >
            <RotateCcw size={13} aria-hidden="true" />
            恢复组件默认设置
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ComponentRow({
  children,
  label
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="min-w-16 flex-1 text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function SizeSlider({ label, value, disabled, onChange }: {
  label: string; value: number; disabled: boolean; onChange: (value: number) => void;
}) {
  const percent = Math.round(value * 100);
  return <div className="flex w-36 shrink-0 items-center gap-2">
    <input type="range" aria-label={label} aria-valuetext={`${percent}%`} min={50} max={200} step={1}
      disabled={disabled} value={percent} className="h-5 min-w-0 flex-1 cursor-pointer accent-primary disabled:opacity-40"
      onChange={event => onChange(Number(event.target.value) / 100)} />
    <Button type="button" variant="plain" size="xs" disabled={disabled}
      className="h-6 w-11 px-0 text-xs tabular-nums text-muted-foreground hover:text-primary"
      aria-label={`${label}恢复100%`} title="点击恢复 100%" onClick={() => onChange(1)}>{percent}%</Button>
  </div>;
}

function TextSizeSlider({ disabled, label, value, onChange }: {
  disabled: boolean; label: string; value: ReflowComponentTextSize; onChange: (value: ReflowComponentTextSize) => void;
}) {
  return <SizeSlider label={`${label}文字大小`} disabled={disabled} value={reflowTextSizeScale(value)} onChange={onChange} />;
}

function VisualSizeSlider({ disabled, label, value, onChange }: {
  disabled: boolean; label: string; value: ReflowVisualSize; onChange: (value: ReflowVisualSize) => void;
}) {
  return <SizeSlider label={`${label}展示大小`} disabled={disabled} value={reflowVisualSizeScale(value)} onChange={onChange} />;
}
