import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RotateCcw, Tag, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listTagArchives, notifyTagArchivesChanged, purgeTagArchive, type TagArchive } from '@/shared/ipc/tagReadingApi';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';

export function TagArchiveList({ root, refreshKey, onRestore, scope = 'library', query = '' }: {
  root: string | null; refreshKey: string; onRestore: (id: string) => Promise<number>; scope?: string; query?: string;
}) {
  const [items, setItems] = useState<TagArchive[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingPurge, setPendingPurge] = useState<TagArchive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const operation = useRef<Promise<boolean> | null>(null);
  const liveRoot = useRef(root);
  liveRoot.current = root;
  useEffect(() => setPendingPurge(null), [root]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!root) { setItems([]); setLoading(false); return; }
    void listTagArchives(root).then((archives) => { if (!cancelled) { setItems(archives.reverse()); setError(null); } })
      .catch((caught) => { if (!cancelled) setError(String(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root, refreshKey, reload]);
  useEffect(() => {
    const unregister = registerSegmentEditorCloseHandler(scope, 'tag-archive-operation', {
      save: () => operation.current ?? Promise.resolve(true), isDirty: () => Boolean(operation.current), discard: () => undefined
    });
    return () => { unregister(); setSegmentEditorDirty(scope, 'tag-archive-operation', false); };
  }, [scope]);

  const run = (item: TagArchive, action: () => Promise<string>): Promise<boolean> => {
    if (!root || operation.current) return Promise.resolve(false);
    const capturedRoot = root;
    setBusy(item.archive_id); setError(null); setNotice(null);
    setSegmentEditorDirty(scope, 'tag-archive-operation', true);
    const task = Promise.resolve().then(action).then((message) => {
      if (liveRoot.current === capturedRoot) {
        setItems((current) => current.filter((candidate) => candidate.archive_id !== item.archive_id));
        setNotice(message);
        notifyTagArchivesChanged(capturedRoot);
      }
      return true;
    }).catch((caught) => { if (liveRoot.current === capturedRoot) setError(String(caught)); return false; })
      .finally(() => { operation.current = null; setSegmentEditorDirty(scope, 'tag-archive-operation', false); if (liveRoot.current === capturedRoot) setBusy(null); });
    operation.current = task;
    return task;
  };
  const visible = items.filter((item) => `${item.root_tag.name} ${item.root_tag.description ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="min-w-0" aria-label="已删除标签">
    <h3 className="mb-2 text-sm font-semibold">已删除标签</h3>
    <div className="entry-library-table-shell min-w-0 overflow-x-auto border border-border">
      <Table className="min-w-[500px] table-fixed border-collapse">
        <colgroup><col className="w-[14%]" /><col className="w-[56%]" /><col className="w-[16%]" /><col className="w-[14%]" /></colgroup>
        <TableHeader><TableRow>
          <TableHead className="h-7 border-r border-border bg-muted/45 px-2 text-center text-[11px] font-semibold">类型</TableHead>
          <TableHead className="h-7 border-r border-border bg-muted/45 px-2 text-left text-[11px] font-semibold">名称与摘要</TableHead>
          <TableHead className="h-7 border-r border-border bg-muted/45 px-2 text-center text-[11px] font-semibold">删除时间</TableHead>
          <TableHead className="h-7 bg-muted/45 px-2 text-center text-[11px] font-semibold">操作</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {loading || visible.length === 0 ? <TableRow><TableCell colSpan={4} className="py-8 text-center text-xs text-muted-foreground">{loading ? '正在读取…' : '暂无已删除标签'}</TableCell></TableRow> : visible.map((item) => <TableRow key={item.archive_id}>
            <TableCell className="h-9 border-r border-border px-2 py-1 text-center"><Badge className="gap-1" variant="outline"><Tag size={12} aria-hidden="true" />标签</Badge></TableCell>
            <TableCell className="h-9 border-r border-border px-2 py-1"><div className="min-w-0" title={item.root_tag.name}><div className="truncate text-sm font-medium leading-5">{item.root_tag.name}</div><div className="truncate text-[11px] leading-4 text-muted-foreground">{item.tags.length} 个标签{item.root_tag.description ? ` · ${item.root_tag.description}` : ''}</div></div></TableCell>
            <TableCell className="h-9 border-r border-border px-2 py-1 text-center text-xs text-muted-foreground" title={formatDate(item.deleted_at)}><div className="truncate">{formatDate(item.deleted_at)}</div></TableCell>
            <TableCell className="h-9 px-2 py-1"><div className="flex justify-center gap-1">
              <Button size="icon-xs" title="恢复" aria-label={`恢复标签 ${item.root_tag.name}`} variant="outline" disabled={Boolean(busy)} onClick={() => { void run(item, async () => { const missing = await onRestore(item.archive_id); return missing ? `标签已恢复；${missing} 个条目已不存在。` : '标签及其阅读资料已恢复。'; }); }}><RotateCcw size={13} aria-hidden="true" /></Button>
              <Button size="icon-xs" title="彻底删除" aria-label={`彻底删除标签 ${item.root_tag.name}`} variant="destructive" disabled={Boolean(busy)} onClick={() => setPendingPurge(item)}><Trash2 size={13} aria-hidden="true" /></Button>
            </div></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </div>
    {notice ? <p role="status" className="mt-2 text-xs text-muted-foreground">{notice}</p> : null}
    {error ? <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive"><span className="min-w-0 flex-1 break-words">{error}</span><Button size="xs" variant="outline" disabled={Boolean(busy)} onClick={() => setReload((value) => value + 1)}>刷新列表</Button></div> : null}
    <Dialog open={Boolean(pendingPurge)} onOpenChange={(open) => { if (!open && !busy) setPendingPurge(null); }}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true" />彻底删除标签？</DialogTitle>
        <DialogDescription>将永久删除此标签组的描述、标签笔记和阅读进度。条目及其笔记不会被删除；此操作无法撤销。</DialogDescription></DialogHeader>
        {pendingPurge ? <div className="rounded-md border bg-muted/35 px-3 py-2 text-sm font-medium">{pendingPurge.root_tag.name} · {pendingPurge.tags.length} 个标签</div> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={Boolean(busy)} onClick={() => setPendingPurge(null)}>取消</Button>
          <Button variant="destructive" disabled={!pendingPurge || !root || Boolean(busy)} onClick={() => { if (!pendingPurge || !root) return; const item = pendingPurge; void run(item, async () => { await purgeTagArchive(root, item.archive_id); return '标签已彻底删除。'; }).then((ok) => { if (ok) setPendingPurge(null); }); }}>彻底删除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
