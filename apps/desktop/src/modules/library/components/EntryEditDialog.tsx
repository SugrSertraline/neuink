import { Loader2, Save, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/shared/hooks/useToast';
import type { TagMeta } from '@/shared/types/domain';

import {
  EntryFieldsEditor,
  fieldsToRecord,
  fieldsFromRecord,
  type EntryFieldDraft
} from './EntryFieldsEditor';
import type { LibraryEntry } from './LibrarySidebar';
import { TagQuickPicker } from './TagQuickPicker';
import {
  parseTagInput
} from '../utils/tagSelection';

type EntryEditDialogProps = {
  entry: LibraryEntry;
  open: boolean;
  tags: TagMeta[];
  onOpenChange: (open: boolean) => void;
  onUpdateEntry: (
    entryId: string,
    request: {
      fields: Record<string, string>;
      tagPaths: string[];
      title: string;
    }
  ) => Promise<unknown> | unknown;
};

export function EntryEditDialog({
  entry,
  open,
  tags,
  onOpenChange,
  onUpdateEntry
}: EntryEditDialogProps) {
  const { notify } = useToast();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [description, setDescription] = useState(entry.fields.description ?? '');
  const [fields, setFields] = useState<EntryFieldDraft[]>(() =>
    fieldsFromRecord(entry.fields)
  );
  const [tagInput, setTagInput] = useState(entry.tags.join(', '));
  const selectedTagPaths = useMemo(
    () => parseTagInput(tagInput),
    [tagInput]
  );
  const dirty =
    title !== entry.title ||
    description !== (entry.fields.description ?? '') ||
    tagInput !== entry.tags.join(', ') ||
    JSON.stringify(fieldsToRecord(fields)) !==
      JSON.stringify(fieldsToRecord(fieldsFromRecord(entry.fields)));

  useEffect(() => {
    if (!open) {
      return;
    }

    setTitle(entry.title);
    setDescription(entry.fields.description ?? '');
    setFields(fieldsFromRecord(entry.fields));
    setTagInput(entry.tags.join(', '));
  }, [entry, open]);

  const saveEntry = async () => {
    if (!title.trim() || saving || !dirty) {
      return;
    }

    try {
      setSaving(true);
      await onUpdateEntry(entry.id, {
        title: title.trim(),
        fields: {
          ...fieldsToRecord(fields),
          ...(description.trim() ? { description: description.trim() } : {})
        },
        tagPaths: selectedTagPaths
      });
      notify({ tone: 'success', title: '条目信息已保存' });
      onOpenChange(false);
    } catch (caught) {
      notify({
        tone: 'danger',
        title: '保存条目信息失败',
        description: caught instanceof Error ? caught.message : undefined
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(46rem,calc(100vh-2rem))] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑条目</DialogTitle>
          <DialogDescription>
            修改标题、描述、标签和属性。
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[calc(100vh-12rem)] gap-4 overflow-auto pr-1">
          <div className="grid gap-2">
            <Label htmlFor="entry-edit-title">标题</Label>
            <Input
              id="entry-edit-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="entry-edit-description">描述</Label>
            <Textarea
              id="entry-edit-description"
              className="min-h-24 resize-y leading-6"
              placeholder="添加描述"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="entry-edit-tags">标签</Label>
            <Input
              id="entry-edit-tags"
              placeholder="输入或选择标签路径，以逗号分隔"
              value={tagInput}
              onChange={(event) => setTagInput(parseTagInput(event.target.value).join(', '))}
            />
            {selectedTagPaths.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selectedTagPaths.map((path) => (
                  <Button
                    key={path}
                    className="h-6 gap-1 rounded-full px-2 text-xs"
                    size="sm"
                    type="button"
                    variant="secondary"
                    onClick={() => setTagInput(toggleTagPath(path, selectedTagPaths).join(', '))}
                  >
                    <span className="max-w-64 truncate">{path}</span>
                    <X size={12} aria-hidden="true" />
                  </Button>
                ))}
              </div>
            ) : null}
            <TagQuickPicker
              allowMultiple
              selectedPaths={selectedTagPaths}
              tags={tags}
              onTogglePath={(path) =>
                setTagInput(toggleTagPath(path, selectedTagPaths).join(', '))
              }
            />
          </div>

          <EntryFieldsEditor fields={fields} onFieldsChange={setFields} />
        </div>

        <DialogFooter>
          <Button
            disabled={saving}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            disabled={!dirty || saving || !title.trim()}
            type="button"
            onClick={() => void saveEntry()}
          >
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toggleTagPath(path: string, selected: string[]) {
  if (selected.includes(path)) {
    return selected.filter((tagPath) => tagPath !== path);
  }

  return [...selected, path];
}
