import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { CopyPlus, FilePlus2, Loader2, Save, X } from 'lucide-react';
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
  onAttachPdf?: (entryId: string, pdfPath: string) => Promise<void> | void;
  onCreatePdfVersion?: (entryId: string, pdfPath: string) => Promise<void> | void;
  onImportMineruClientResult?: (entryId: string, zipPath: string) => Promise<unknown> | unknown;
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
  onAttachPdf,
  onCreatePdfVersion,
  onImportMineruClientResult,
  onUpdateEntry
}: EntryEditDialogProps) {
  const { notify } = useToast();
  const [saving, setSaving] = useState(false);
  const [pdfAction, setPdfAction] = useState<'attach' | 'version' | null>(null);
  const [importingMineru, setImportingMineru] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [description, setDescription] = useState(entry.fields.description ?? entry.fields['描述'] ?? '');
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
    description !== (entry.fields.description ?? entry.fields['描述'] ?? '') ||
    tagInput !== entry.tags.join(', ') ||
    JSON.stringify(fieldsToRecord(fields)) !==
      JSON.stringify(fieldsToRecord(fieldsFromRecord(entry.fields)));

  useEffect(() => {
    if (!open) {
      return;
    }

    setTitle(entry.title);
    setDescription(entry.fields.description ?? entry.fields['描述'] ?? '');
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
          ...Object.fromEntries(
            Object.entries(fieldsToRecord(fields)).filter(([key]) => key !== '描述')
          ),
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

  const choosePdf = async () => {
    const action = entry.pdfFileName ? 'version' : 'attach';
    const handler = action === 'attach' ? onAttachPdf : onCreatePdfVersion;
    if (!handler || pdfAction) return;

    const selected = await openFileDialog({
      directory: false,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      multiple: false
    });
    if (typeof selected !== 'string') return;

    setPdfAction(action);
    try {
      await handler(entry.id, selected);
      notify({
        tone: 'success',
        title: action === 'attach' ? 'PDF 已加入并开始解析' : '已创建新版 PDF 条目'
      });
    } catch (caught) {
      notify({
        tone: 'danger',
        title: action === 'attach' ? '上传 PDF 失败' : '创建新版 PDF 失败',
        description: caught instanceof Error ? caught.message : String(caught)
      });
    } finally {
      setPdfAction(null);
    }
  };

  const chooseMineruResult = async () => {
    if (!entry.pdfFileName || !onImportMineruClientResult || importingMineru) return;
    const selected = await openFileDialog({ directory: false, filters: [{ name: 'MinerU 客户端结果', extensions: ['zip'] }], multiple: false });
    if (typeof selected !== 'string') return;
    setImportingMineru(true);
    try {
      await onImportMineruClientResult(entry.id, selected);
      notify({ tone: 'success', title: 'MinerU 客户端结果已导入' });
    } catch (caught) {
      notify({ tone: 'danger', title: '导入 MinerU 客户端结果失败', description: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setImportingMineru(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(46rem,calc(100vh-2rem))] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑条目</DialogTitle>
          <DialogDescription>
            修改标题、描述、标签和属性。
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1">
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

          {onAttachPdf && onCreatePdfVersion ? (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/25 px-3 py-2.5">
              <div className="min-w-0">
                <Label className="text-sm">PDF 文件</Label>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {entry.pdfFileName
                    ? `当前文件：${entry.pdfFileName}。新版会创建为独立条目，原文件不会被覆盖。`
                    : '尚未上传 PDF。选择后将自动导入并开始解析。'}
                </p>
              </div>
              <Button disabled={pdfAction !== null} size="sm" type="button" variant="outline" onClick={() => void choosePdf()}>
                {pdfAction ? <Loader2 className="animate-spin" size={14} /> : entry.pdfFileName ? <CopyPlus size={14} /> : <FilePlus2 size={14} />}
                {entry.pdfFileName ? '创建新版 PDF' : '上传 PDF'}
              </Button>
            </div>
          ) : null}
          {entry.pdfFileName && onImportMineruClientResult ? (
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/25 px-3 py-2.5">
              <div className="min-w-0"><Label className="text-sm">MinerU 客户端结果</Label><p className="mt-0.5 text-xs leading-5 text-muted-foreground">导入包含 content_list、images 等产物的完整 ZIP；将替换当前解析结果，不会覆盖 PDF。</p></div>
              <Button disabled={importingMineru} size="sm" type="button" variant="outline" onClick={() => void chooseMineruResult()}>{importingMineru ? <Loader2 className="animate-spin" size={14} /> : <FilePlus2 size={14} />}从客户端导入</Button>
            </div>
          ) : null}

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

        <DialogFooter className="shrink-0 border-t pt-4">
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
