import { Check, RotateCcw } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { type ReflowComponentKey, type ReflowContentPreference, type ReflowContentOverrides } from '@/shared/lib/reflowContentPreferences';
import { SegmentMenuButton } from '../SegmentMenuButton';

const layers = [
    { key: 'image' as const, label: '原图' },
    { key: 'parsed' as const, label: '解析后内容' },
    { key: 'translation' as const, label: '翻译' },
  ];

export function ReflowContentControls({ component, label, value, disabled, onChange, showTranslationView = true }: {
  showTranslationView?: boolean; component: ReflowComponentKey; label: string; value: ReflowContentPreference; disabled: boolean;
  onChange: (patch: ReflowContentOverrides) => void;
}) {
  return <div className="grid grid-cols-3 gap-1 border-l-2 border-border pl-2" role="group" aria-label={`${label}内容显示`}>
    {layers.map(layer => <label key={layer.key}
      className={`flex min-w-0 items-center justify-between gap-1 rounded border px-1.5 py-1 text-[11px] ${disabled ? 'opacity-50' : 'cursor-pointer'} ${value[layer.key] ? 'border-transparent bg-muted/40 text-foreground' : 'border-transparent text-muted-foreground'}`}>
      <Checkbox className="size-3.5" disabled={disabled} aria-label={`${label}显示${layer.label}`} checked={value[layer.key]}
        onCheckedChange={checked => onChange({ [layer.key]: checked === true })} />
      <span className="flex-1">{layer.label}</span>
    </label>)}
    {showTranslationView && component === 'paragraph' ? <label className="col-span-3 flex items-center justify-between gap-2 text-xs">
      逐句对照
      <Switch aria-label="正文逐句对照" disabled={disabled} checked={value.translationView === 'sentences'}
        onCheckedChange={checked => onChange({ translationView: checked ? 'sentences' : 'paragraph' })} />
    </label> : null}
  </div>;
}

export function ReflowSegmentContentActions({ component, value, overridden, onChange }: {
  component: ReflowComponentKey; value: ReflowContentPreference; overridden: boolean;
  onChange: (patch: ReflowContentOverrides | null) => void;
}) {
  const check = (selected: boolean) => <span className="inline-flex size-3.5 shrink-0">{selected ? <Check size={14} aria-hidden="true" /> : null}</span>;
  return <div className="my-1 border-y py-1" role="group" aria-label="此片段显示">
    <div className="px-2 py-1 text-xs text-muted-foreground">此片段显示 · {overridden ? '自定义' : '跟随组件设置'}</div>
    {layers.map(layer => <SegmentMenuButton key={layer.key} role="menuitemcheckbox" aria-checked={value[layer.key]}
      icon={check(value[layer.key])} label={`显示${layer.label}`} onClick={() => onChange({ [layer.key]: !value[layer.key] })} />)}
    {component === 'paragraph' ? <div role="group" aria-label="对照方式">
      <div className="px-2 py-1 text-xs text-muted-foreground">翻译排列</div>
      {(['paragraph', 'sentences'] as const).map(view => <SegmentMenuButton key={view} role="menuitemradio" aria-checked={value.translationView === view}
        icon={check(value.translationView === view)} label={view === 'paragraph' ? '整段对照' : '逐句对照'}
        onClick={() => onChange({ translationView: view, translation: true })} />)}
    </div> : null}
    <SegmentMenuButton disabled={!overridden} icon={<RotateCcw size={14} aria-hidden="true" />} label="恢复跟随组件设置" onClick={() => onChange(null)} />
  </div>;
}

/** Local display choice; the existing preferences provider owns persistence. */
export function ReflowSegmentViewControls({ value, onChange, onInteraction }: {
  value: 'inherit' | 'paragraph' | 'sentences';
  onChange: (value: 'inherit' | 'paragraph' | 'sentences') => void;
  onInteraction: () => void;
}) {
  return <div className="reflow-segment-fold-tabs h-6 shrink-0">
    <ToggleGroup type="single" value={value} size="sm" spacing={0} aria-label="本段对照方式"
      className="h-6 rounded-md border border-border bg-background"
      onValueChange={next => { if (next) { onInteraction(); onChange(next as typeof value); } }}
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      onMouseMove={event => { event.stopPropagation(); onInteraction(); }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.closest('section')?.focus(); } }}>
      <ToggleGroupItem value="inherit" className="h-6 px-2 text-[11px]" aria-label="对照方式跟随全局">跟随</ToggleGroupItem>
      <ToggleGroupItem value="paragraph" className="h-6 px-2 text-[11px]" aria-label="本段整段对照">整段</ToggleGroupItem>
      <ToggleGroupItem value="sentences" className="h-6 px-2 text-[11px]" aria-label="本段逐句对照">逐句</ToggleGroupItem>
    </ToggleGroup>
  </div>;
}
