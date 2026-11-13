import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cloudAccount } from '@/shared/ipc/cloudAccountApi';

type Item = { id: string; kind: string; title: string; parent_title: string; revision: number; deleted: boolean;
  fields: Record<string, string>; resources: { name: string; hash: string; size: number }[] };
type Contents = { revision: number; items: Item[]; attachment_bytes: number; attachment_count: number };
const labels: Record<string, string> = { entry: '论文', note: '笔记', annotation: '批注', tag: '标签', segment_note: '片段笔记',
  card: '研究卡片', board: '构思', translation: '译文', fold: '阅读详略', parse_snapshot: '阅读快照' };
const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;

/** Server-only snapshot; component owns filters, DialogBody owns vertical scrolling. */
export function CloudContents({ root }: { root: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Contents | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Item | null>(null);
  const [readAt, setReadAt] = useState('');
  const generation = useRef(0);
  useEffect(() => { generation.current++; setOpen(false); setData(null); return () => { generation.current++; }; }, [root]);
  async function refresh() {
    const owner = ++generation.current;
    setBusy(true); setData(null); setSelected(null); setError(''); setPage(0);
    try {
      const value = await cloudAccount<Contents>({ action: 'sync_cloud_contents', root });
      if (owner !== generation.current) return;
      setData(value); setReadAt(new Date().toLocaleTimeString());
    } catch (e) { if (owner === generation.current) setError(typeof e === 'string' ? e : '读取云端内容失败，请检查网络后重试'); }
    finally { if (owner === generation.current) setBusy(false); }
  }
  const rows = (data?.items ?? []).filter(item => (kind === 'deleted' ? item.deleted : !item.deleted && (kind === 'all' || item.kind === kind))
    && `${item.title} ${item.parent_title} ${item.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pageRows = rows.slice(page * 50, (page + 1) * 50);
  function close(value: boolean) { setOpen(value); if (!value) { generation.current++; setBusy(false); setData(null); setSelected(null); } }
  return <>
    <Button size="sm" variant="outline" onClick={() => { setOpen(true); void refresh(); }}>查看云端内容</Button>
    <Dialog open={open} onOpenChange={close}>
      <DialogContent layout="bounded" className="h-auto max-h-[calc(100%-2rem)] sm:max-w-4xl">
        <DialogHeader><DialogTitle>云端内容 · 我的资料库</DialogTitle><DialogDescription>直接查看服务器当前保存的清单。查看不会上传、导入或修改本地资料；Zotero 来源缓存不参与上传。</DialogDescription></DialogHeader>
        <DialogBody className="space-y-3 text-sm">
          {busy && <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />正在读取云端清单…</p>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {data && <>
            <p className="text-xs text-muted-foreground">云端有效内容 {data.items.filter(i => !i.deleted).length} 项 · 去重附件 {data.attachment_count} 个 / {bytes(data.attachment_bytes)} · 读取于 {readAt} · 版本 {data.revision}</p>
            <p className="text-xs text-muted-foreground">附件大小仅统计当前清单，历史版本另计。笔记正文、PDF 和阅读内容仍通过同步后的本地阅读器打开。</p>
            <div className="flex flex-wrap gap-2">
              <SearchInput label="搜索云端内容" placeholder="搜索标题、所属论文或标识" value={query} onValueChange={value => { setQuery(value); setPage(0); setSelected(null); }} />
              <Select value={kind} onValueChange={value => { setKind(value); setPage(0); setSelected(null); }}><SelectTrigger aria-label="云端内容类型" className="w-40"><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="all">全部有效内容</SelectItem>
                {Object.entries(labels).map(([value, label]) => <SelectItem key={value} value={value}>{label}（{data.items.filter(i => !i.deleted && i.kind === value).length}）</SelectItem>)}
                <SelectItem value="deleted">已删除记录（{data.items.filter(i => i.deleted).length}）</SelectItem>
              </SelectContent></Select>
            </div>
            {rows.length === 0 ? <p className="py-4 text-muted-foreground">{data.items.length ? '没有匹配的云端内容' : '云端资料库暂无内容'}</p> : <Table>
              <TableHeader><TableRow><TableHead>名称 / 所属论文</TableHead><TableHead>类型</TableHead><TableHead>附件</TableHead><TableHead>查看</TableHead></TableRow></TableHeader>
              <TableBody>{pageRows.map(item => <TableRow key={item.id} data-state={selected?.id === item.id ? 'selected' : undefined}>
                <TableCell className="max-w-96"><p className="truncate" title={item.title}>{item.title}</p>{item.parent_title && item.title !== item.parent_title && <p className="truncate text-xs text-muted-foreground" title={item.parent_title}>{item.parent_title}</p>}</TableCell>
                <TableCell className="whitespace-nowrap">{item.deleted ? '已删除 · ' : ''}{labels[item.kind] ?? item.kind}</TableCell><TableCell>{item.resources.length}</TableCell>
                <TableCell><Button size="sm" variant="ghost" aria-label={`查看 ${item.title}`} onClick={() => setSelected(item)}>详情</Button></TableCell>
              </TableRow>)}</TableBody>
            </Table>}
            <Dialog open={!!selected} onOpenChange={value => { if (!value) setSelected(null); }}>
            {selected && <DialogContent layout="bounded" className="h-auto max-h-[calc(100%-2rem)]">
              <DialogHeader><DialogTitle className="break-all">{selected.title}</DialogTitle><DialogDescription>云端保存的元信息与附件清单，只读查看。</DialogDescription></DialogHeader>
              <DialogBody className="space-y-2 text-sm">
              <p className="break-all text-xs text-muted-foreground">{labels[selected.kind]} · 云端版本 {selected.revision} · {selected.id}</p>
              {selected.deleted && <p>此内容已在云端删除。这里展示删除记录，不代表仍可下载原文件。</p>}
              {Object.entries(selected.fields).map(([name, value]) => <div key={name}><p className="text-xs text-muted-foreground">{name}</p><p className="whitespace-pre-wrap break-words">{value}</p></div>)}
              {selected.resources.length > 0 && <><h4 className="font-medium">云端附件清单</h4>{selected.resources.map(file => <p key={file.name} className="break-all text-xs">{file.name} · {bytes(file.size)}</p>)}</>}
              {!selected.deleted && !selected.resources.length && <p className="text-xs text-muted-foreground">此项没有独立附件。</p>}
              </DialogBody><DialogFooter><Button size="sm" variant="outline" onClick={() => setSelected(null)}>关闭详情</Button></DialogFooter>
            </DialogContent>}
            </Dialog>
          </>}
        </DialogBody>
        <DialogFooter className="flex-wrap">
          {data && <><span className="mr-auto self-center text-xs text-muted-foreground">{rows.length} 项 · 第 {page + 1} / {Math.max(1, Math.ceil(rows.length / 50))} 页</span><Button size="sm" variant="ghost" disabled={!page} onClick={() => { setPage(page - 1); setSelected(null); }}>上一页</Button><Button size="sm" variant="ghost" disabled={(page + 1) * 50 >= rows.length} onClick={() => { setPage(page + 1); setSelected(null); }}>下一页</Button></>}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>刷新云端清单</Button><Button size="sm" variant="outline" onClick={() => close(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
