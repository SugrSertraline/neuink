import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ImportPanelFrame, ImportPanelBody, ImportPanelFooter } from '@/modules/import/ImportPanelFrame';
import type { ImportPreviewRequest } from '@/shared/ipc/importPreviewApi';
import { SearchInput } from '@/components/ui/search-input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ImportSourceSwitch, type ImportSource } from '@/modules/import/ImportSourceSwitch';
import { openPathInFileManager } from '@/shared/ipc/assistantApi';
import { MineruSourceControls } from './MineruSourceControls';
import { useMineruSource } from './useMineruSource';
import { useMineruImport } from './useMineruImport';

const PAGE_SIZE = 50;
function displayPath(path: string) {
  let prefixLength = 0;
  while (path[prefixLength] === '\\') prefixLength += 1;
  if (prefixLength < 2 || path[prefixLength] !== '?' || path[prefixLength + 1] !== '\\') return path;
  const rest = path.slice(prefixLength + 2);
  return rest.toUpperCase().startsWith('UNC\\') ? `\\\\${rest.slice(4)}` : rest;
}
export function MineruImportDialog({ root, onClose, onImported, onOpenEntry, onSwitchSource, embedded, active = true, onBusyChange, onPreview, scope = 'library' }: {
  embedded?: boolean; active?: boolean; onBusyChange?: (busy: boolean) => void; onPreview?: (request: ImportPreviewRequest, title: string) => void; scope?: string;
  root: string; onClose: () => void; onImported?: () => Promise<void> | void; onOpenEntry?: (id: string) => void; onSwitchSource?: (source: ImportSource) => void;
}) {
  const model = useMineruImport(root, onImported, scope);
  const source = useMineruSource(active, model.reset);
  useEffect(() => { onBusyChange?.(model.busy); }, [model.busy, onBusyChange]);
  const sourceDirectory = source.settings?.results_directory;
  useEffect(() => {
    if (sourceDirectory) void model.load();
    else model.reset();
  }, [sourceDirectory, root, model.load, model.reset]);
  const [query, setQuery] = useState('');
  const [openError, setOpenError] = useState('');
  const [page, setPage] = useState(0);
  const items = model.snapshot?.items ?? [];
  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(item => terms.every(term => `${item.title} ${displayPath(item.path)}`.toLocaleLowerCase().includes(term)));
  }, [items, query]);
  useEffect(() => { setPage(0); }, [query, model.snapshot]);
  const eligible = filtered.filter(item => item.has_pdf && !model.outcomes[item.id]?.result);
  const selectedVisible = eligible.filter(item => model.selected.has(item.id)).length;
  const imported = Object.values(model.outcomes).filter(outcome => outcome.result?.status === 'imported').length;
  const skipped = Object.values(model.outcomes).filter(outcome => outcome.result?.status === 'skipped').length;
  const failed = Object.values(model.outcomes).filter(outcome => outcome.error).length;
  const close = () => { if (!model.busy) onClose(); };
  const openResultLocation = async (path: string) => {
    setOpenError('');
    try { await openPathInFileManager(path); }
    catch { setOpenError('无法打开结果位置，请检查文件是否仍在原目录。'); }
  };
  return <ImportPanelFrame embedded={embedded} busy={model.busy} onClose={close} title="从 MinerU 导入" description="读取本机已有解析结果，选择论文后复制到 NeuInk。结果目录、ZIP 和 RAR 均可识别。">
    {onSwitchSource && <ImportSourceSwitch source="mineru" onChange={onSwitchSource} disabled={model.busy} />}
      <ImportPanelBody>
        <div className="mb-4"><MineruSourceControls source={source} disabled={model.busy} onBeforeChoose={() => { if (model.loading) model.reset(); }} /></div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={model.busy || model.loading || source.busy || !sourceDirectory} onClick={() => void model.load()}>{model.loading ? '正在读取…' : model.snapshot ? '刷新结果列表' : '重试读取'}</Button>
          {model.loading ? <span role="status" className="text-xs text-muted-foreground">正在检查本机 MinerU 结果…</span>
            : model.snapshot && <span className="text-xs text-muted-foreground">找到 {items.length} 项结果{model.snapshot.truncated ? ' · 目录较大，仅显示部分结果' : ''}</span>}
        </div>
        {model.error && <p role="alert" className="mb-3 text-xs text-destructive">{model.error}</p>}
        {openError && <p role="alert" className="mb-3 text-xs text-destructive">{openError}</p>}
        {model.snapshot && <>
          <div className="mb-3"><SearchInput label="搜索 MinerU 结果" placeholder="搜索论文标题或来源路径" value={query} onValueChange={setQuery} /></div>
          <label className="mb-2 flex items-center gap-2 text-xs"><Checkbox aria-label="全选当前筛选结果" disabled={model.busy || !eligible.length}
            checked={selectedVisible === eligible.length && eligible.length > 0 ? true : selectedVisible > 0 ? 'indeterminate' : false}
            onCheckedChange={checked => model.setSelected(previous => { const next = new Set(previous); for (const item of eligible) { if (checked === true) next.add(item.id); else next.delete(item.id); } return next; })} />全选当前结果（{filtered.length} 项）</label>
          {filtered.length ? <Table className="table-fixed text-xs">
            <TableHeader className="bg-muted"><TableRow><TableHead className="w-10"><span className="sr-only">选择</span></TableHead><TableHead>解析结果</TableHead><TableHead className="w-36">导入状态</TableHead></TableRow></TableHeader>
            <TableBody>{filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(item => {
              const outcome = model.outcomes[item.id];
              return <TableRow key={item.id} data-state={model.selected.has(item.id) ? 'selected' : undefined}>
                <TableCell className="align-top pt-3"><Checkbox aria-label={`选择 ${item.title}`} checked={model.selected.has(item.id)} disabled={model.busy || !item.has_pdf || Boolean(outcome?.result)}
                  onCheckedChange={checked => model.setSelected(previous => { const next = new Set(previous); if (checked === true) next.add(item.id); else next.delete(item.id); return next; })} /></TableCell>
                <TableCell className="min-w-0 overflow-hidden py-2"><p className="truncate font-medium" title={item.title}>{item.title}</p>
                  <div className="mt-1 flex min-w-0 items-center gap-1 text-muted-foreground"><span className="shrink-0">{item.kind === 'directory' ? '结果目录' : item.kind.toUpperCase()} ·</span>
                    <span className="min-w-0 flex-1 truncate" title={displayPath(item.path)}>{displayPath(item.path)}</span></div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="xs" variant="outline" aria-label={`打开 ${item.title} 的${item.kind === 'directory' ? '结果目录' : '所在文件夹'}`} onClick={() => void openResultLocation(item.path)}>打开目录</Button>
                    {onPreview && <Button size="xs" variant="outline" disabled={!item.has_pdf} onClick={() => onPreview({ source: 'mineru', root, snapshot_id: model.snapshot!.snapshot_id, item_id: item.id }, item.title)}>预览 PDF</Button>}
                  </div></TableCell>
                <TableCell className="whitespace-normal align-top py-2">{outcome?.result ? <div className="grid justify-items-start gap-1"><span className="text-success">{outcome.result.status === 'imported' ? '已导入' : '已在本地'}</span>
                  {onOpenEntry && <Button size="xs" variant="outline" disabled={model.busy} onClick={() => { close(); onOpenEntry(outcome.result!.entry_id); }}>打开</Button>}</div>
                  : outcome?.error ? <p role="alert" className="break-words text-destructive">{outcome.error}</p>
                  : <span className="text-muted-foreground">{item.has_pdf ? '可导入' : '缺少原 PDF'}</span>}</TableCell>
              </TableRow>;
            })}</TableBody>
          </Table> : <p className="py-10 text-center text-sm text-muted-foreground">{items.length ? '没有符合条件的结果。' : '此目录没有可识别的 MinerU 结果。可改选结果根目录。'}</p>}
          {filtered.length > PAGE_SIZE && <div className="mt-3 flex items-center justify-end gap-2 text-xs"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button><span>{page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}</span><Button size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= filtered.length} onClick={() => setPage(value => value + 1)}>下一页</Button></div>}
        </>}
      </ImportPanelBody>
      <ImportPanelFooter>
        {model.progress.total > 0 && <div role="status" className="grid gap-1 text-xs"><p className="truncate" title={model.progress.current}>{model.busy ? model.progress.stopped ? '正在停止，等待当前论文保存…' : `正在导入：${model.progress.current}` : model.progress.stopped ? '导入已停止，已完成的论文保留。' : '本批导入已结束。'}</p>
          <progress aria-label="MinerU 导入进度" className="h-1 w-full accent-primary" max={model.progress.total} value={model.progress.completed} />
          <p className="text-muted-foreground">本次处理 {model.progress.completed}/{model.progress.total} · 新增 {imported} · 已存在 {skipped} · 待重试 {failed}</p></div>}
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">已选 {model.selected.size} 项{model.selected.size > selectedVisible ? '（包含筛选外结果）' : ''}</span>
          <div className="flex items-center gap-2">{model.busy ? <Button variant="outline" disabled={model.progress.stopped} onClick={model.cancel}>停止导入</Button> : <>
            {!embedded && <Button variant="outline" onClick={close}>关闭</Button>}<Button disabled={model.loading || source.busy || !model.selected.size} onClick={() => void model.start()}>{failed ? '重试／导入所选' : '导入所选'}</Button>
          </>}</div></div>
      </ImportPanelFooter>
  </ImportPanelFrame>;
}
