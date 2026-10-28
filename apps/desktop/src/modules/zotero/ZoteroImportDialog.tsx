import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ImportPanelFrame, ImportPanelBody, ImportPanelFooter } from '@/modules/import/ImportPanelFrame';
import type { ImportPreviewRequest } from '@/shared/ipc/importPreviewApi';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImportSourceSwitch, type ImportSource } from '@/modules/import/ImportSourceSwitch';
import { ZoteroSourceControls } from './ZoteroSourceControls';
import { ZoteroPaperList } from './ZoteroPaperList';
import { useZoteroSource } from './useZoteroSource';
import { useZoteroImport } from './useZoteroImport';

const PAGE_SIZE = 50;
export function ZoteroImportDialog({ root, onClose, onOpenEntry, onSwitchSource, scope = 'library', embedded, active = true, onBusyChange, onPreview }: {
  embedded?: boolean; active?: boolean; onBusyChange?: (busy: boolean) => void; onPreview?: (request: ImportPreviewRequest, title: string) => void; 
  root: string; onClose: () => void; onOpenEntry?: (id: string) => void; onSwitchSource?: (source: ImportSource) => void; scope?: string;
}) {
  const model = useZoteroImport(root, scope);
  const source = useZoteroSource(active, model.reset);
  useEffect(() => { onBusyChange?.(model.busy); }, [model.busy, onBusyChange]);
  const sourceKey = JSON.stringify(source.settings);
  useEffect(() => {
    if (source.settings?.data_directory) void model.load();
    else model.reset();
  }, [sourceKey, root, model.load, model.reset]);
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState('__all');
  const [page, setPage] = useState(0);
  const papers = model.snapshot?.library.papers ?? [];
  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return papers.filter(p => (collection === '__all' || p.collection_ids.includes(collection)) && terms.every(t => `${p.title} ${p.authors} ${p.year} ${p.fields.doi ?? ''} ${p.tags.join(' ')}`.toLocaleLowerCase().includes(t)));
  }, [papers, query, collection]);
  useEffect(() => { setPage(0); }, [query, collection, model.snapshot]);
  useEffect(() => { setCollection('__all'); setQuery(''); }, [model.snapshot?.snapshot_id]);
  const eligible = filtered.filter(p => !model.snapshot?.existing[p.id] && !model.outcomes[p.id]?.result);
  const selectedVisible = eligible.filter(p => model.selected.has(p.id)).length;
  const successes = Object.values(model.outcomes).filter(r => r.result?.status === 'imported').length;
  const skipped = Object.values(model.outcomes).filter(r => r.result?.status === 'skipped').length;
  const failures = Object.values(model.outcomes).filter(r => r.error).length;
  const close = () => { if (!model.busy) onClose(); };
  return <ImportPanelFrame embedded={embedded} busy={model.busy} onClose={close} title="从 Zotero 导入" description="选择文献，复制本地 PDF 和基本信息。笔记与批注暂不迁移。">
    {onSwitchSource && <ImportSourceSwitch source="zotero" onChange={onSwitchSource} disabled={model.busy} />}
      <ImportPanelBody>
        <div className="mb-4"><ZoteroSourceControls source={source} disabled={model.busy} showLinked={papers.some(p => p.attachments.some(a => a.reason === '需要设置链接附件基础目录' || a.reason === '链接附件未找到，请检查基础目录或文件是否已移动'))} /></div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={model.busy || model.loading || source.busy || !source.settings?.data_directory} onClick={() => void model.load()}>{model.loading ? '正在读取…' : model.snapshot ? '刷新论文列表' : '重试读取'}</Button>
          {model.loading ? <span role="status" className="text-xs text-muted-foreground">正在读取本机论文列表…</span> : model.snapshot && <span className="text-xs text-muted-foreground">共 {papers.length} 篇文献</span>}
        </div>
        {model.error && <p role="alert" className="mb-3 text-xs text-destructive">{model.error}</p>}
        {model.snapshot && <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchInput label="搜索 Zotero 论文" placeholder="搜索标题、作者、标签或 DOI" value={query} onValueChange={setQuery} className="min-w-0 flex-[1_1_240px]" />
            <Select value={collection} onValueChange={setCollection}><SelectTrigger aria-label="Zotero 分类" className="w-full min-w-0 sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent viewportAligned><SelectItem value="__all">全部分类</SelectItem>{model.snapshot.library.collections.map(c => <SelectItem key={c.id} value={c.id}>{c.path}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="mb-2 flex items-center gap-2 text-xs"><Checkbox aria-label="全选当前筛选结果" disabled={model.busy || !eligible.length} checked={selectedVisible === eligible.length && eligible.length > 0 ? true : selectedVisible > 0 ? 'indeterminate' : false} onCheckedChange={checked => model.setSelected(previous => {
            const next = new Set(previous); for (const p of eligible) { if (checked === true) next.add(p.id); else next.delete(p.id); } return next;
          })} />全选当前结果（{filtered.length} 篇）</label>
          {filtered.length ? <ZoteroPaperList onPreview={onPreview ? (paperId, attachmentKey, title) => onPreview({ source: 'zotero', root, snapshot_id: model.snapshot!.snapshot_id, paper_id: paperId, attachment_key: attachmentKey }, title) : undefined} papers={filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)} model={model} onOpenEntry={onOpenEntry ? id => { close(); onOpenEntry(id); } : undefined} />
            : <p className="py-10 text-center text-sm text-muted-foreground">{papers.length ? '没有符合条件的论文。' : '此资料库没有可导入的文献。'}</p>}
          {filtered.length > PAGE_SIZE && <div className="mt-3 flex items-center justify-end gap-2 text-xs"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</Button><span>{page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}</span><Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(p => p + 1)}>下一页</Button></div>}
        </>}
      </ImportPanelBody>
      <ImportPanelFooter>
        {model.progress.total > 0 && <div role="status" className="grid gap-1 text-xs">
          <p className="truncate" title={model.progress.current}>{model.busy ? model.progress.stopped ? '正在停止，等待当前论文保存…' : `正在导入：${model.progress.current}` : model.progress.stopped ? '导入已停止，已完成的论文保留。' : '本批导入已结束。'}</p>
          <progress aria-label="Zotero 导入进度" className="h-1 w-full accent-primary" max={model.progress.total} value={model.progress.completed} />
          <p className="text-muted-foreground">本次处理 {model.progress.completed}/{model.progress.total} · 累计新增 {successes} · 已存在 {skipped} · 待重试 {failures}</p>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">已选 {model.selected.size} 篇{model.selected.size > selectedVisible ? '（包含筛选外条目）' : ''}</span>
          <div className="flex items-center gap-2">{model.busy ? <Button variant="outline" disabled={model.progress.stopped} onClick={model.cancel}>停止导入</Button> : <>
            {!embedded && <Button variant="outline" onClick={close}>关闭</Button>}<Button disabled={model.loading || source.busy || !model.selected.size} onClick={() => void model.start()}>{failures ? '重试／导入所选' : '导入所选'}</Button>
          </>}</div>
        </div>
      </ImportPanelFooter>
  </ImportPanelFrame>;
}
