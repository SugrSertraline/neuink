import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FieldDefinitionsDialog, useFieldDefinitions } from './FieldDefinitionsDialog';
import type { FieldDefinition } from '@/shared/ipc/fieldDefinitionsApi';

export type EntryFieldDraft = {
  id: string;
  key: string;
  value: string;
};

export function EntryFieldsEditor({
  addLabel = '添加属性',
  disabled,
  emptyText = '暂无额外属性。',
  fields,
  label = '属性',
  onFieldsChange, workspaceRoot, scopeKey, ownerId
}: {
  workspaceRoot?: string | null;
  scopeKey?: string;
  ownerId?: string;
  addLabel?: string;
  disabled?: boolean;
  emptyText?: string;
  fields: EntryFieldDraft[];
  label?: string;
  onFieldsChange: (fields: EntryFieldDraft[]) => void;
}) {
  const { definitions, error, loading, retry } = useFieldDefinitions(workspaceRoot);
  const defaultNames = new Set(['出版类型', '期刊／会议名称', '发表年份', 'DOI', '收录情况', 'JCR 分区', 'CCF 等级', '评价年份', '评价来源']);
  const emptyDefaults = definitions.filter(d => !d.hidden && defaultNames.has(d.name) && !fields.some(f => f.key === d.name));
  const available = definitions.filter(d => !d.hidden && !defaultNames.has(d.name) && !fields.some(f => f.key === d.name));
  const updateField = (id: string, patch: Partial<EntryFieldDraft>) => {
    onFieldsChange(
      fields.map((field) => (field.id === id ? { ...field, ...patch } : field))
    );
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        <div className="flex flex-wrap items-center gap-2">
        {workspaceRoot && <FieldDefinitionsDialog root={workspaceRoot} scopeKey={scopeKey} ownerId={ownerId} definitions={definitions} disabled={loading || Boolean(error) || disabled} onChanged={() => {}} />}
        {available.length > 0 && <Select disabled={disabled} value="" onValueChange={name => onFieldsChange([...fields, { id: `${Date.now()}-${fields.length}`, key: name, value: '' }])}><SelectTrigger aria-label="选择已定义属性" className="w-40"><SelectValue placeholder="选择属性" /></SelectTrigger><SelectContent>{available.map(d => <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>)}</SelectContent></Select>}
        <Button
          disabled={disabled}
          size="sm"
          type="button"
          variant="outline"
          onClick={() =>
            onFieldsChange([
              ...fields,
              { id: `${Date.now()}-${fields.length}`, key: '', value: '' }
            ])
          }
        >
          <Plus size={14} aria-hidden="true" />
          {addLabel}
        </Button></div>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error} <Button size="xs" variant="outline" onClick={retry}>重试读取</Button></p>}

      <div className="grid gap-2">
        {emptyDefaults.map(definition => <div key={definition.name} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto] items-center gap-2">
          <span className="px-3 text-sm">{definition.name}</span>
          <FieldValue field={{ id: definition.name, key: definition.name, value: '' }} definition={definition} disabled={disabled} onChange={value => {
            if (value) onFieldsChange([...fields, { id: `${Date.now()}-${fields.length}`, key: definition.name, value }]);
          }} />
          <span aria-hidden="true" className="size-8" />
        </div>)}
        {fields.map((field) => (
          <div
            className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto] gap-2"
            key={field.id}
          >
            <Input
              disabled={disabled}
              placeholder="属性名"
              value={field.key}
              onChange={(event) => updateField(field.id, { key: event.target.value })}
            />
            <FieldValue field={field} definition={definitions.find(d => d.name === field.key)} disabled={disabled} onChange={value => updateField(field.id, { value })} />
            <Button
              disabled={disabled}
              size="icon-sm"
              title="移除属性"
              type="button"
              variant="outline"
              onClick={() => onFieldsChange(fields.filter((item) => item.id !== field.id))}
            >
              <X size={13} aria-hidden="true" />
            </Button>
          </div>
        ))}
        {fields.length === 0 && emptyDefaults.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Library-wide definitions determine which values can be edited on an entry. */
export function EntryDefinedFieldValues({ workspaceRoot, fields, disabled, onFieldsChange }: { workspaceRoot: string | null; fields: EntryFieldDraft[]; disabled?: boolean; onFieldsChange: (fields: EntryFieldDraft[]) => void }) {
  const { definitions, error, loading, retry } = useFieldDefinitions(workspaceRoot);
  const visible = definitions.filter(item => !item.hidden);
  const legacy = fields.filter(field => !definitions.some(item => item.name === field.key));
  const change = (name: string, value: string) => {
    const existing = fields.find(field => field.key === name);
    if (existing) onFieldsChange(fields.map(field => field.id === existing.id ? { ...field, value } : field));
    else if (value) onFieldsChange([...fields, { id: `${Date.now()}-${fields.length}`, key: name, value }]);
  };
  return <section className="grid gap-2" aria-label="条目属性"><Label>属性值</Label>
    {loading && <p role="status" className="text-xs text-muted-foreground">正在读取属性…</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error} <Button size="xs" variant="outline" onClick={retry}>重试读取</Button></p>}
    {visible.map(definition => { const field = fields.find(item => item.key === definition.name) ?? { id: definition.name, key: definition.name, value: '' }; return <div key={definition.name} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] items-center gap-2"><span className="px-3 text-sm">{definition.name}</span><FieldValue field={field} definition={definition} disabled={disabled || loading || Boolean(error)} onChange={value => change(definition.name, value)} /></div>; })}
    {legacy.length > 0 && <p className="text-xs text-muted-foreground">此条目保留了未纳入属性管理的历史字段，保存时不会删除。</p>}
  </section>;
}

export function fieldsFromRecord(fields: Record<string, string>) {
  return Object.entries(fields)
    .filter(([key]) => key !== 'description')
    .map(([key, value], index) => ({
      id: `${key}-${index}`,
      key,
      value
    }));
}

export function fieldsToRecord(fields: EntryFieldDraft[]) {
  return Object.fromEntries(
    fields
      .map((field) => [field.key.trim(), field.value.trim()])
      .filter(
        ([key, value]) =>
          key.length > 0 &&
          value.length > 0 &&
          !['title', 'description'].includes(key.toLowerCase())
      )
  );
}

export function FieldValue({ field, definition, disabled, onChange }: { field: EntryFieldDraft; definition?: FieldDefinition; disabled?: boolean; onChange: (value: string) => void }) {
  if (definition?.kind === 'select' || definition?.kind === 'boolean') {
    const options = definition.kind === 'boolean' ? ['是', '否'] : definition.options;
    const all = field.value && !options.includes(field.value) ? [field.value, ...options] : options;
    return <Select disabled={disabled} value={field.value} onValueChange={onChange}><SelectTrigger aria-label={`${field.key}的值`}><SelectValue placeholder="请选择" /></SelectTrigger><SelectContent>{all.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>;
  }
  if (definition?.kind === 'multi_select') {
    let selected: string[];
    try { const value: unknown = JSON.parse(field.value || '[]'); if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) throw new Error(); selected = value; }
    catch { return <Input disabled={disabled} placeholder="属性值" value={field.value} onChange={event => onChange(event.target.value)} />; }
    const options = [...new Set([...definition.options, ...selected])];
    return <div className="flex flex-wrap gap-2">{options.map(value => <label key={value} className="flex items-center gap-1 text-xs"><Checkbox disabled={disabled} checked={selected.includes(value)} onCheckedChange={checked => { const next = checked === true ? [...selected, value] : selected.filter(v => v !== value); onChange(next.length ? JSON.stringify(next) : ''); }} />{value}</label>)}</div>;
  }
  const legacyNumber = definition?.kind === 'number' && field.value !== '' && !Number.isFinite(Number(field.value));
  if (definition?.kind === 'date') {
    const precision = definition.date_precision ?? 'day';
    if (precision === 'year') return <Input disabled={disabled} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="年，例如 2025" aria-label={`${field.key}的值`} value={field.value} onChange={event => onChange(event.target.value)} />;
    const valid = precision === 'month' ? /^\d{4}-(0[1-9]|1[0-2])$/.test(field.value) : /^\d{4}-\d{2}-\d{2}$/.test(field.value) && !Number.isNaN(new Date(`${field.value}T00:00:00Z`).getTime()) && new Date(`${field.value}T00:00:00Z`).toISOString().slice(0, 10) === field.value;
    return <Input disabled={disabled} type={field.value && !valid ? 'text' : precision === 'month' ? 'month' : 'date'} placeholder="属性值" aria-label={`${field.key}的值`} value={field.value} onChange={event => onChange(event.target.value)} />;
  }
  return <Input disabled={disabled} type={legacyNumber ? 'text' : definition?.kind === 'number' ? 'number' : 'text'} placeholder="属性值" step={definition?.kind === 'number' ? 'any' : undefined} value={field.value} onChange={event => onChange(event.target.value)} />;
}
