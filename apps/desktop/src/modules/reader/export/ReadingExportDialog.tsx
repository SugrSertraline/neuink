import { save } from '@tauri-apps/plugin-dialog';
import { Loader2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/shared/hooks/useToast';
import { exportReading, inspectReadingExport, type ReadingExportCatalog, type ReadingExportFormat, type ReadingExportKind, type ReadingExportScope } from '@/shared/ipc/readingExportApi';
import { sanitizeExportFileName } from '../../notes/components/markdownNoteEditorSupport';
import { hasUnsavedMarkdownNote, saveMarkdownNoteBeforeClose } from '../../notes/editor/noteDirtyRegistry';
import { hasUnsavedEntrySegmentEditors } from '../components/segmentEditorDirtyRegistry';
import { exportTagNotes, inspectTagNoteExport } from '@/shared/ipc/noteOwnerApi';

const KINDS: Record<ReadingExportKind, string> = { note: '文档笔记', segment_note: '片段记录', annotation: '批注', translation: '片段译文' };
const FORMATS: Record<ReadingExportFormat, { label: string; extension: string }> = {
  docx: { label: '合并为 Word (.docx)', extension: 'docx' },
  txt: { label: '合并为 TXT (.txt)', extension: 'txt' },
  txt_zip: { label: '每项一个 TXT · 分享包 (.zip)', extension: 'zip' },
  docx_zip: { label: '每项一个 Word · 分享包 (.zip)', extension: 'zip' }
};

type Props = {
  entryId: string;
  tagId?: string;
  entryTitle: string;
  workspaceRoot: string | null;
  noteId?: string;
  scope?: ReadingExportScope;
  scopeLabel?: string;
  preselectScope?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

export function ReadingExportDialog(props: Props) {
  // A new context gets a fresh selection; late responses cannot populate another entry's dialog.
  return props.open ? <ReadingExportSession key={JSON.stringify([props.workspaceRoot, props.entryId, props.tagId, props.noteId, props.scope])} {...props} /> : null;
}

function ReadingExportSession({ entryId, tagId, entryTitle, workspaceRoot, noteId, scope, scopeLabel, preselectScope = false, open, onOpenChange, onCloseAutoFocus }: Props) {
  const { notify } = useToast();
  const fieldId = useId();
  const [catalog, setCatalog] = useState<ReadingExportCatalog | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<ReadingExportKind | 'all'>('all');
  const [format, setFormat] = useState<ReadingExportFormat>(noteId ? 'docx' : 'txt_zip');
  const [allowIncomplete, setAllowIncomplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const busyRef = useRef(false);
  const initialized = useRef(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let disposed = false;
    setCatalog(null);
    setError(null);
    setAllowIncomplete(false);
    if (!workspaceRoot) { setError('资料库不可用，请重新打开资料库。'); return; }
    const inspection = tagId ? inspectTagNoteExport(workspaceRoot, tagId, noteId) : scope ? inspectReadingExport(workspaceRoot, entryId, noteId, scope) : inspectReadingExport(workspaceRoot, entryId, noteId);
    void inspection.then((next) => {
      if (disposed) return;
      if (scope && !next.scope_applied) throw new Error('桌面后端尚未更新，无法确认当前导出范围，请重启项目后重试。');
      setCatalog(next);
      const firstLoad = !initialized.current;
      setSelected((previous) => new Set(next.items.filter((item) =>
        firstLoad ? Boolean((preselectScope && scope) || (noteId && item.note_id === noteId)) : previous.has(item.id)
      ).map((item) => item.id)));
      initialized.current = true;
    }).catch((caught: unknown) => { if (!disposed) setError(String(caught)); });
    return () => { disposed = true; };
  }, [workspaceRoot, entryId, tagId, noteId, scope, preselectScope, refresh]);

  const chosen = catalog?.items.filter((item) => selected.has(item.id)) ?? [];
  const visible = catalog?.items.filter((item) => filter === 'all' || item.kind === filter) ?? [];
  const warnings = chosen.flatMap((item) => item.warnings.map((warning) => `${item.title}：${warning}`));
  const dirtyNotes = () => chosen.filter((item) => item.note_id && hasUnsavedMarkdownNote(entryId, item.note_id));
  const dirtyFragments = () => chosen.some((item) => item.kind !== 'note') && hasUnsavedEntrySegmentEditors(entryId);
  const updateSelection = (ids: string[], checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) { if (checked) next.add(id); else next.delete(id); }
      return next;
    });
    setAllowIncomplete(false);
  };
  const reload = () => { setCatalog(null); setRefresh((value) => value + 1); };

  const saveSelectedNotes = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      for (const item of dirtyNotes()) {
        if (item.note_id && !await saveMarkdownNoteBeforeClose(entryId, item.note_id)) {
          throw new Error(`“${item.title}”未能保存，请回到笔记处理错误或版本冲突。`);
        }
      }
      if (dirtyNotes().length) throw new Error('保存期间笔记又有修改，请保存完成后重试。');
      if (live.current) reload();
    } catch (caught) { if (live.current) setError(String(caught)); }
    finally { busyRef.current = false; if (live.current) setBusy(false); }
  };

  const startExport = async () => {
    if (!workspaceRoot || !catalog || chosen.length === 0 || busyRef.current || (warnings.length > 0 && !allowIncomplete)) return;
    if (dirtyNotes().length) { setError('所选文档笔记有未保存修改，请先保存所选笔记并刷新。'); return; }
    if (dirtyFragments()) { setError('当前论文有未保存的片段记录或批注，请回到阅读页面保存后刷新清单。'); return; }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const info = FORMATS[format];
      const title = chosen.length === 1 ? chosen[0].title : `${entryTitle}-阅读成果`;
      const path = await save({ defaultPath: `${sanitizeExportFileName(title)}.${info.extension}`, filters: [{ name: info.label, extensions: [info.extension] }] });
      if (!path || !live.current) return;
      if (dirtyNotes().length) throw new Error('选择保存位置期间笔记又有修改，请保存并刷新后重试。');
      if (dirtyFragments()) throw new Error('片段记录或批注仍有未保存修改，请回到阅读页面保存后刷新清单。');
      const options = { selected: chosen.map(({ id, fingerprint }) => ({ id, fingerprint })), format, target_path: path, allow_incomplete: allowIncomplete };
      if (tagId) await exportTagNotes(workspaceRoot, tagId, options);
      else await exportReading({ root: workspaceRoot, entry_id: entryId, ...options });
      if (live.current) {
        notify({ tone: 'success', title: `已导出 ${chosen.length} 项阅读成果`, description: path });
        onOpenChange(false);
      }
    } catch (caught) { if (live.current) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { busyRef.current = false; if (live.current) setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!busyRef.current) onOpenChange(next); }}>
    <DialogContent layout="bounded" className="max-w-[42rem] gap-3 sm:max-w-[42rem]" showCloseButton={!busy} onCloseAutoFocus={onCloseAutoFocus}>
      <DialogHeader className="shrink-0 pr-6">
        <DialogTitle>{scopeLabel ?? (noteId ? '导出文档笔记' : '导出阅读成果')}</DialogTitle>
        <DialogDescription className="space-y-1" asChild><div>
          <p className="line-clamp-2 break-words" title={catalog?.entry_title ?? entryTitle}>{catalog?.entry_title ?? entryTitle}</p>
          <p>只导出勾选的已保存内容及关联引用文字，不包含原 PDF、未选内容或聊天记录。</p>
        </div></DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3 text-sm" role="region" aria-label="阅读成果导出选项和清单" tabIndex={0}>
        <div className="grid gap-3 @min-[28rem]/dialog:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <span id={`${fieldId}-format`} className="text-xs font-medium">文件格式</span>
            <Select disabled={busy} value={format} onValueChange={(value) => setFormat(value as ReadingExportFormat)}>
              <SelectTrigger aria-labelledby={`${fieldId}-format`} className="w-full min-w-0 [&>span]:truncate"><SelectValue /></SelectTrigger>
              <SelectContent viewportAligned align="start">{Object.entries(FORMATS).map(([value, info]) => <SelectItem key={value} value={value}>{info.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {!noteId && (!scope?.kinds || scope.kinds.length > 1) ? <div className="grid min-w-0 gap-1.5">
            <span id={`${fieldId}-filter`} className="text-xs font-medium">筛选类型（不改变已选项）</span>
            <Select disabled={busy} value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
              <SelectTrigger aria-labelledby={`${fieldId}-filter`} className="w-full min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent viewportAligned align="start"><SelectItem value="all">全部类型</SelectItem>{Object.entries(KINDS).filter(([value]) => !scope?.kinds || scope.kinds.includes(value as ReadingExportKind)).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div> : null}
        </div>
        <p className="text-xs text-muted-foreground">Word 保留标题、段落、表格及可用图片；TXT 仅保留文字。公式和 Mermaid 保留源码。分享包按当前论文建文件夹，附索引。</p>
        {!catalog && !error ? <p role="status">正在读取已保存的阅读成果…</p> : null}
        {catalog ? <>
          <div className="flex flex-wrap items-center gap-2">
            <span role="status">共 {catalog.items.length} 项 · 已选 {chosen.length} 项</span>
            <Button disabled={busy || visible.length === 0} variant="ghost" size="xs" onClick={() => updateSelection(visible.map((item) => item.id), true)}>全选当前列表</Button>
            <Button disabled={busy || selected.size === 0} variant="ghost" size="xs" onClick={() => updateSelection([...selected], false)}>清空选择</Button>
            <Button disabled={busy} variant="ghost" size="xs" onClick={reload}>刷新清单</Button>
          </div>
          {visible.length === 0 ? <p className="py-4 text-muted-foreground">{catalog.items.length ? '该类型暂无已保存内容。' : '暂无可导出的阅读成果，请先创建并保存笔记、片段记录、批注或译文。'}</p> : null}
          <ul className="divide-y rounded-md border">
            {visible.map((item) => <li key={item.id}>
              <label className="flex min-w-0 cursor-pointer items-start gap-2 px-3 py-2 hover:bg-muted/50">
                <Checkbox className="mt-0.5" aria-label={`选择 ${item.title}`} checked={selected.has(item.id)} disabled={busy} onCheckedChange={(checked) => updateSelection([item.id], checked === true)} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{item.title}</span>
                  <span className="block text-xs text-muted-foreground">{KINDS[item.kind]}{item.page ? ` · PDF 第 ${item.page} 页` : ''}</span>
                  <span className="block break-words text-xs text-muted-foreground">{item.preview}</span>
                  {item.warnings.length ? <span className="block text-xs text-warning">{item.warnings.length} 项待核对提示</span> : null}
                </span>
              </label>
            </li>)}
          </ul>
        </> : null}
        {chosen.some((item) => item.note_id) ? <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{dirtyNotes().length ? '所选笔记有未保存修改。' : '导出前会再次检查笔记的保存状态。'}</span>
          <Button disabled={busy} variant="outline" size="xs" onClick={() => void saveSelectedNotes()}>保存所选笔记并刷新</Button>
        </div> : null}
        {warnings.length ? <details className="rounded-md border px-3 py-2"><summary className="cursor-pointer">查看所选内容的 {warnings.length} 项提示</summary>
          <ul className="mt-2 space-y-2 text-xs">{warnings.map((warning, index) => <li key={index} className="break-words">{warning}</li>)}</ul>
        </details> : null}
        {error ? <div role="alert" className="space-y-2 text-destructive"><p className="break-words">{error}</p><Button disabled={busy} variant="outline" size="xs" onClick={reload}>刷新后重试</Button></div> : null}
        {warnings.length ? <label className="flex items-start gap-2 text-xs"><Switch aria-label="保留待核对提示并导出" disabled={busy} checked={allowIncomplete} onCheckedChange={setAllowIncomplete} /><span>保留待核对提示并导出；不把缺失图片或旧译文标为完整、最新内容。</span></label> : null}
      </DialogBody>
      <DialogFooter className="shrink-0 gap-2 border-t pt-3">
        <Button disabled={busy} variant="outline" size="sm" onClick={() => onOpenChange(false)}>取消</Button>
        <Button disabled={busy || !catalog || chosen.length === 0 || Boolean(error) || (warnings.length > 0 && !allowIncomplete)} size="sm" onClick={() => void startExport()}>
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}{busy ? '正在处理…' : '选择位置并导出'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
