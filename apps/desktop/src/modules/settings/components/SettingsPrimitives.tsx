import { useId, type ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { TabsContent } from '@/components/ui/tabs';
import type { SettingsTab } from '../settingsCatalog';

export function SettingsPage({ tab, title, description, children }: { tab: SettingsTab; title: string; description: string; children: ReactNode }) {
  return <TabsContent forceMount value={tab} className="settings-content">
    <div className="settings-panel-content-inner settings-form"><header className="mb-4"><h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></header>{children}</div>
  </TabsContent>;
}

export function SettingsGroup({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return <section data-setting-id={id} tabIndex={id ? -1 : undefined} className="settings-group">
    <h3 className="text-sm font-semibold">{title}</h3>{description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}
    <div className="mt-2">{children}</div>
  </section>;
}

type SettingRowProps = { id?: string; label: string; description?: string; disabled?: boolean; children: ReactNode; controlId?: string; className?: string };
export function SettingRow({ id, label, description, children, controlId, className = '' }: SettingRowProps) {
  return <div data-setting-id={id} tabIndex={id ? -1 : undefined} className={`settings-row ${className}`}>
    <div className="min-w-0 flex-1"><Label htmlFor={controlId} className="text-[13px] font-medium">{label}</Label>
      {description && <p id={controlId ? `${controlId}-description` : undefined} className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}</div>
    <div className="settings-row-control">{children}</div>
  </div>;
}

export function SettingSwitch({ id, label, description, disabled, checked, onCheckedChange }: Omit<SettingRowProps, 'children'> & { checked: boolean; onCheckedChange: (value: boolean) => void }) {
  const controlId = useId();
  return <SettingRow id={id} label={label} description={description} controlId={controlId}>
    <Switch id={controlId} aria-describedby={description ? `${controlId}-description` : undefined} disabled={disabled} checked={checked} onCheckedChange={onCheckedChange} />
  </SettingRow>;
}

export function SettingSelect({ id, label, description, disabled, value, options, placeholder = '请选择', onValueChange }: Omit<SettingRowProps, 'children'> & { value: string; placeholder?: string; options: ReadonlyArray<{ value: string; label: string }>; onValueChange: (value: string) => void }) {
  const controlId = useId();
  return <SettingRow id={id} label={label} description={description} controlId={controlId} className="settings-row-select">
    <Select disabled={disabled} value={value} onValueChange={onValueChange}><SelectTrigger id={controlId} aria-describedby={description ? `${controlId}-description` : undefined} size="sm" className="w-full min-w-0"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </SettingRow>;
}

export function SettingCheckbox({ label, checked, disabled, onCheckedChange }: { label: string; checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void }) {
  const id = useId();
  return <Label htmlFor={id} className="flex items-center gap-2 py-1.5 text-xs font-normal leading-5">
    <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={value => onCheckedChange(value === true)} />{label}
  </Label>;
}
