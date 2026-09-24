import { RotateCcw, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ReflowContentControls } from './ReflowContentControls';
import { resolveReflowContent, type ReflowComponentKey, type ReflowContentOverrides } from '@/shared/lib/reflowContentPreferences';
import {
  DEFAULT_REFLOW_COMPONENT_PREFERENCES,
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
  onChange
}: {
  preferences: ReaderPreferences;
  onChange: (preferences: ReaderPreferences) => void;
}) {
  const components = preferences.reflowComponents;
  const updateComponents = (next: ReflowComponentPreferences) => {
    onChange({ ...preferences, reflowComponents: next });
  };
  const contentControls = (key: ReflowComponentKey, label: string) => <ReflowContentControls component={key} label={label}
    disabled={!components[key].visible} value={resolveReflowContent(key, preferences.reflowTranslationMode, components.content?.[key])}
    onChange={(patch: ReflowContentOverrides) => updateComponents({ ...components, content: {
      ...components.content, [key]: { ...components.content?.[key], ...patch },
    } })} />;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
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
        className="max-h-[min(34rem,calc(100vh-5rem))] w-80 overflow-y-auto p-0"
        sideOffset={8}
      >
        <div className="border-b px-3 py-2.5">
          <div className="text-sm font-semibold">组件显示</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            每个片段的原图、解析后内容分别控制，可同时显示。按类型批量设置，右键片段可单独覆盖。
          </p>
        </div>

        <div className="divide-y">
          {TEXT_COMPONENTS.map(({ key, label }) => (
            <div key={key}><ComponentRow label={label}>
              <Switch
                aria-label={`显示${label}`}
                checked={components[key].visible}
                onCheckedChange={(visible) =>
                  updateComponents({
                    ...components,
                    [key]: { ...components[key], visible }
                  })
                }
              />
              <TextSizeSelect
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
            <div key={key}><ComponentRow label={label}>
              <Switch
                aria-label={`显示${label}`}
                checked={components[key].visible}
                onCheckedChange={(visible) =>
                  updateComponents({
                    ...components,
                    [key]: { ...components[key], visible }
                  })
                }
              />
              <VisualSizeSelect
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

          <ComponentRow label="点击图片查看详情">
            <Switch
              aria-label="点击图片查看详情"
              checked={components.imageClickToOpen}
              onCheckedChange={(imageClickToOpen) =>
                updateComponents({ ...components, imageClickToOpen })
              }
            />
          </ComponentRow>
        </div>

        <div className="border-t p-2">
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
    <div className="flex min-h-11 items-center gap-2 px-3 py-2">
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      {children}
    </div>
  );
}

function TextSizeSelect({
  disabled,
  label,
  value,
  onChange
}: {
  disabled: boolean;
  label: string;
  value: ReflowComponentTextSize;
  onChange: (value: ReflowComponentTextSize) => void;
}) {
  return (
    <Select disabled={disabled} value={value} onValueChange={(next) => onChange(next as ReflowComponentTextSize)}>
      <SelectTrigger aria-label={`${label}文字大小`} className="h-7 w-[6.5rem]" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="small">较小</SelectItem>
        <SelectItem value="standard">标准</SelectItem>
        <SelectItem value="large">较大</SelectItem>
      </SelectContent>
    </Select>
  );
}

function VisualSizeSelect({
  disabled,
  label,
  value,
  onChange
}: {
  disabled: boolean;
  label: string;
  value: ReflowVisualSize;
  onChange: (value: ReflowVisualSize) => void;
}) {
  return (
    <Select disabled={disabled} value={value} onValueChange={(next) => onChange(next as ReflowVisualSize)}>
      <SelectTrigger aria-label={`${label}展示大小`} className="h-7 w-[6.5rem]" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="compact">紧凑</SelectItem>
        <SelectItem value="standard">标准</SelectItem>
        <SelectItem value="large">较大</SelectItem>
        <SelectItem value="full">撑满宽度</SelectItem>
      </SelectContent>
    </Select>
  );
}
