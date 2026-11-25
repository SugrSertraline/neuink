import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { listTrashItems } from '@/shared/ipc/workspaceApi';
import { readNoteCatalog, notifyNotesChanged } from '@/shared/ipc/noteCatalogApi';
import { listTagArchives, purgeTagArchive, notifyTagArchivesChanged } from '@/shared/ipc/tagReadingApi';
import { purgeTagNote } from '@/shared/ipc/noteOwnerApi';
import { hasAnyUnsavedMarkdownNotes } from '@/modules/notes/editor/noteDirtyRegistry';
import { useNoteAction } from '@/modules/notes/useNoteAction';
import { planEmptyTrash, runTrashPurge, type TrashPurgeTask } from './emptyWorkspaceTrash';

// This control owns confirmation/progress. The existing trash view owns list scrolling;
// Dialog provides focus trapping and Escape, disabled only while an operation is running.
export function EmptyWorkspaceTrashButton({ root, externalIds, onPurgeEntry, onPurgeItem }: {
  root: string | null; externalIds: ReadonlySet<string>;
  onPurgeEntry: (id: string) => Promise<void> | void;
  onPurgeItem: (entryId: string, id: string) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ReturnType<typeof planEmptyTrash> | null>(null);
  const [result, setResult] = useState<{ succeeded: number; failures: string[] } | null>(null);
  const [done, setDone] = useState(0);
  const action = useNoteAction('library', root);
  useEffect(() => { setOpen(false); setPlan(null); setResult(null); }, [root]);
  const total = plan ? plan.entries.length + plan.records.length + plan.archives.length + plan.tagNotes.length : 0;
  const load = () => {
    setOpen(true); setPlan(null); setResult(null); setDone(0);
    void action.run(async current => {
      if (!root) return;
      const [items, archives, catalog] = await Promise.all([listTrashItems(root), listTagArchives(root), readNoteCatalog(root)]);
      if (catalog.errors.length) throw new Error('部分笔记无法读取，请修复或刷新后再清空回收站。');
      if (current()) setPlan(planEmptyTrash(items, archives, catalog.notes, externalIds));
    });
  };
  const confirm = () => void action.run(async current => {
    if (!root || !plan || !total || result) return;
    if (hasAnyUnsavedMarkdownNotes()) throw new Error('有笔记尚未保存，请先保存或明确放弃修改，再清空回收站。');
    const tasks: TrashPurgeTask[] = [
      ...plan.entries.map(item => ({ label: item.title, run: () => onPurgeEntry(item.entry_id) })),
      ...plan.records.map(item => ({ label: item.title, run: () => onPurgeItem(item.entry_id, item.trash_id) })),
      ...plan.tagNotes.map(note => ({ label: note.title, run: async () => {
        if (note.error) throw new Error(note.error);
        if (note.target.owner.kind === 'tag_reading') await purgeTagNote(root, note.target.owner.tag_id, note.target.note_id, note.revision);
      } })),
      ...plan.archives.map(archive => ({ label: archive.root_tag.name, run: () => purgeTagArchive(root, archive.archive_id) }))
    ];
    const outcome = await runTrashPurge(tasks, current, setDone);
    notifyTagArchivesChanged(root); notifyNotesChanged(root);
    if (current()) setResult(outcome);
  });
  return <>
    <Button variant="destructive" disabled={!root || action.busy} onClick={load}><Trash2 size={14} aria-hidden="true" />清空回收站</Button>
    <Dialog open={open} onOpenChange={value => { if (!action.busy) setOpen(value); }}>
      <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>清空回收站</DialogTitle>
        <DialogDescription>永久删除回收站内的内容，不受当前搜索和分类筛选影响。此操作无法撤销。</DialogDescription>
      </DialogHeader>
        {plan ? <div className="space-y-2 text-sm">
          <p>条目 {plan.entries.length} 个 · 独立记录 {plan.records.length} 条 · 标签组 {plan.archives.length} 组 · 独立标签笔记 {plan.tagNotes.length} 篇</p>
          <p className="text-muted-foreground">条目所含的 PDF、笔记、批注和解析结果，以及标签组所含的标签笔记和阅读进度，将一并删除。</p>
          {plan.protectedCount > 0 && <p className="text-muted-foreground">{plan.protectedCount} 个来源管理条目及其记录受保护，将保留。</p>}
          {!total && <p role="status">没有可清空的内容。</p>}
        </div> : action.busy ? <p role="status">正在统计回收站…</p> : null}
        {action.busy && plan && <p role="status" className="text-sm">正在清空 {done}/{total}，请勿退出应用…</p>}
        {result && <div className="space-y-2 text-sm"><p role="status">已清理 {result.succeeded} 项{result.failures.length ? `，${result.failures.length} 项未完成，可刷新后重试。` : '，清理完成。'}</p>
          {result.failures.length > 0 && <ul role="alert" className="max-h-40 overflow-y-auto break-words text-xs text-destructive">{result.failures.map((message, index) => <li key={index}>{message}</li>)}</ul>}
        </div>}
        {action.error && <p role="alert" className="text-sm text-destructive">{action.error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={action.busy} onClick={() => setOpen(false)}>{result ? '完成' : '取消'}</Button>
          {result || !plan ? <Button variant="outline" disabled={action.busy} onClick={load}>刷新列表</Button> :
            <Button variant="destructive" disabled={action.busy || !total} onClick={confirm}>{action.busy ? '正在清空…' : '确认清空'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
