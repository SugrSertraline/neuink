import { Check, RotateCcw } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { type ReflowComponentKey, type ReflowContentPreference, type ReflowContentOverrides } from '@/shared/lib/reflowContentPreferences';
import { SegmentMenuButton } from '../SegmentMenuButton';

const layers = [
    { key: 'image' as const, label: '原图' },
    { key: 'parsed' as const, label: '解析后内容' },
    { key: 'translation' as const, label: '翻译' },
  ];

export function ReflowContentControls({ component, label, value, disabled, onChange }: {
  component: ReflowComponentKey; label: string; value: ReflowContentPreference; disabled: boolean;
  onChange: (patch: ReflowContentOverrides) => void;
}) {
  return <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
    {layers.map(layer => <Toggle key={layer.key} size="sm" variant="outline" disabled={disabled}
      aria-label={`${label}显示${layer.label}`} pressed={value[layer.key]} onPressedChange={checked => onChange({ [layer.key]: checked })}
      className="h-7 rounded-md px-2 text-xs">{layer.label}</Toggle>)}
    {component === 'paragraph' ? <Select value={value.translationView} onValueChange={translationView => onChange({ translationView: translationView as ReflowContentPreference['translationView'] })}>
      <SelectTrigger size="sm" aria-label="正文翻译排列" disabled={disabled} className="ml-auto w-24 text-xs"><SelectValue /></SelectTrigger>
      <SelectContent viewportAligned><SelectItem value="paragraph">整段对照</SelectItem><SelectItem value="sentences">逐句对照</SelectItem></SelectContent>
    </Select> : null}
  </div>;
}

export function ReflowSegmentContentActions({ component, value, overridden, onChange, sentenceTranslationDisabled = false }: {
  component: ReflowComponentKey; value: ReflowContentPreference; overridden: boolean;
  onChange: (patch: ReflowContentOverrides | null) => void;
  sentenceTranslationDisabled?: boolean;
}) {
  const check = (selected: boolean) => <span className="inline-flex size-3.5 shrink-0">{selected ? <Check size={14} aria-hidden="true" /> : null}</span>;
  return <div className="my-1 border-y py-1" role="group" aria-label="此片段显示">
    <div className="px-2 py-1 text-xs text-muted-foreground">此片段显示 · {overridden ? '自定义' : '跟随组件设置'}</div>
    {layers.map(layer => <SegmentMenuButton key={layer.key} role="menuitemcheckbox" aria-checked={value[layer.key]}
      icon={check(value[layer.key])} label={`显示${layer.label}`} onClick={() => onChange({ [layer.key]: !value[layer.key] })} />)}
    {component === 'paragraph' ? <div role="group" aria-label="对照方式">
      <div className="px-2 py-1 text-xs text-muted-foreground">翻译排列</div>
      {(['paragraph', 'sentences'] as const).map(view => <SegmentMenuButton key={view} role="menuitemradio" aria-checked={value.translationView === view}
        disabled={view === 'sentences' && sentenceTranslationDisabled}
        icon={check(value.translationView === view)} label={view === 'paragraph' ? '整段对照' : '逐句对照'}
        onClick={() => onChange({ translationView: view, translation: true })} />)}
    </div> : null}
    <SegmentMenuButton disabled={!overridden} icon={<RotateCcw size={14} aria-hidden="true" />} label="恢复跟随组件设置" onClick={() => onChange(null)} />
  </div>;
}
