import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listTagArchives, type TagArchive } from '@/shared/ipc/tagReadingApi';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';

export function TagArchiveList({ root, refreshKey, onRestore, scope = 'library', query = '' }: { root: string | null; refreshKey: string; onRestore: (id: string) => Promise<number>; scope?: string; query?: string }) {
  const [items, setItems] = useState<TagArchive[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const operation = useRef<Promise<boolean> | null>(null);
  const liveRoot = useRef(root);
  liveRoot.current = root;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!root) { setLoading(false); return; }
    void listTagArchives(root).then((archives) => { if (!cancelled) { setItems(archives.reverse()); setError(null); } })
      .catch((caught) => { if (!cancelled) setError(String(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root, refreshKey, reload]);
  useEffect(() => {
    const unregister = registerSegmentEditorCloseHandler(scope, 'tag-restore', {
      save: () => operation.current ?? Promise.resolve(true), isDirty: () => Boolean(operation.current), discard: () => undefined
    });
    return () => { unregister(); setSegmentEditorDirty(scope, 'tag-restore', false); };
  }, [scope]);
  const restore = (id: string) => {
    if (!root || operation.current) return;
    const capturedRoot = root;
    setBusy(id); setError(null); setNotice(null);
    setSegmentEditorDirty(scope, 'tag-restore', true);
    operation.current = onRestore(id).then((missing) => {
      if (liveRoot.current === capturedRoot) {
        setItems((current) => current.filter((item) => item.archive_id !== id));
        setNotice(missing ? `标签已恢复；${missing} 个条目已不存在，未重建这些条目。` : '标签描述、标签笔记、条目关联及阅读进度已恢复。');
      }
      return true;
    }).catch((caught) => { if (liveRoot.current === capturedRoot) setError(String(caught)); return false; })
      .finally(() => { operation.current = null; setSegmentEditorDirty(scope, 'tag-restore', false); if (liveRoot.current === capturedRoot) setBusy(null); });
  };
  return <section className="min-w-0 border-t pt-3" aria-label="已删除标签">
    <h3 className="text-sm font-semibold">已删除标签</h3>
    <p className="mt-1 text-xs text-muted-foreground">恢复标签、子标签、描述、标签笔记、条目关联和阅读进度。已单独删除的笔记保持删除状态。标签暂不支持永久清除。</p>
    {loading ? <p role="status" className="py-2 text-xs">正在读取…</p> : !items.length ? <p className="py-2 text-xs text-muted-foreground">暂无已删除标签</p> : null}
    <ul className="mt-2 divide-y">{items.filter((item) => `${item.root_tag.name} ${item.root_tag.description ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((item) => <li key={item.archive_id} className="flex min-w-0 items-center gap-2 py-2 text-xs">
      <span className="min-w-0 flex-1 truncate" title={item.root_tag.name}>{item.root_tag.name} · {item.tags.length} 个标签</span>
      <Button size="xs" variant="outline" disabled={Boolean(busy)} onClick={() => restore(item.archive_id)}>{busy === item.archive_id ? '恢复中…' : '恢复'}</Button>
    </li>)}</ul>
    {notice ? <p role="status" className="text-xs text-muted-foreground">{notice}</p> : null}
    {error ? <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive"><span className="min-w-0 flex-1 break-words">{error}</span><Button size="xs" variant="outline" disabled={Boolean(busy)} onClick={() => setReload((value) => value + 1)}>刷新列表</Button></div> : null}
  </section>;
}
