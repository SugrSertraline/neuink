import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
  onFieldsChange
}: {
  addLabel?: string;
  disabled?: boolean;
  emptyText?: string;
  fields: EntryFieldDraft[];
  label?: string;
  onFieldsChange: (fields: EntryFieldDraft[]) => void;
}) {
  const updateField = (id: string, patch: Partial<EntryFieldDraft>) => {
    onFieldsChange(
      fields.map((field) => (field.id === id ? { ...field, ...patch } : field))
    );
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
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
        </Button>
      </div>

      <div className="grid gap-2">
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
            <Input
              disabled={disabled}
              placeholder="属性值"
              value={field.value}
              onChange={(event) => updateField(field.id, { value: event.target.value })}
            />
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
        {fields.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : null}
      </div>
    </div>
  );
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
