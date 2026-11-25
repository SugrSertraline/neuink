import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { LibrarySourceChange, LibrarySourceSync } from './useLibrarySourceSync';

export function LibrarySourceReviewDialog({ open, onOpenChange, sync, entries, onOpenEntry, onApplyTitle, onApplyField, onApplyPdfName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sync: LibrarySourceSync;
  entries: LibraryEntry[];
  onOpenEntry: (entryId: string) => void;
  onApplyTitle: (entryId: string, title: string) => Promise<void>;
  onApplyField: (entryId: string, key: string, value: string) => Promise<void>;
  onApplyPdfName: (entryId: string, name: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const entryById = new Map(entries.map(entry => [entry.id, entry]));
  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id); setActionError(null);
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setBusyId(null); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent layout="bounded" className="max-w-[46rem] sm:max-w-[46rem]">
      <DialogHeader>
        <DialogTitle>来源更新</DialogTitle>
        <DialogDescription>打开资料库时检查 Zotero 和 MinerU。逐篇核对后点“已核对”，同一来源版本不再提醒；来源再次变化会重新提示。NeuInk 的普通编辑只修改本地副本。</DialogDescription>
      </DialogHeader>
      <DialogBody role="region" aria-label="来源检查详情" tabIndex={0} className="space-y-3 pr-1">
        {sync.running && <p role="status" className="text-xs text-muted-foreground">{sync.current || '正在检查来源'} · {sync.completed}/{sync.total}</p>}
        {sync.error && <p role="alert" className="text-xs text-destructive">{sync.error}</p>}
        {sync.truncated && <p className="text-xs text-warning">MinerU 目录超过本次扫描范围，部分结果尚未检查。</p>}
        {!sync.running && sync.changes.length === 0 && sync.issues.length === 0 && !sync.error && <p className="py-6 text-center text-sm text-muted-foreground">已检查，没有需要处理的来源变化。</p>}
        {sync.changes.length > 0 && <section className="space-y-2" aria-label="已更新的来源论文">
          <p className="text-xs font-medium">{sync.changes.length} 篇来源内容有更新</p>
          {sync.changes.map((change, index) => <SourceChangeRow key={`${change.source}:${change.entryId}:${index}`} change={change} entry={entryById.get(change.entryId)} busy={busyId === change.entryId}
            onOpen={() => { onOpenChange(false); onOpenEntry(change.entryId); }}
            onAcknowledge={() => sync.acknowledge(change)}
            onApplyTitle={() => run(change.entryId, () => onApplyTitle(change.entryId, change.sourceTitle))}
            onApplyField={(key, value) => run(change.entryId, () => onApplyField(change.entryId, key, value))}
            onApplyPdfName={name => run(change.entryId, () => onApplyPdfName(change.entryId, name))} />)}
        </section>}
        {sync.issues.length > 0 && <section className="space-y-2" aria-label="未完成的来源同步">
          <p className="text-xs font-medium">{sync.issues.length} 项需要检查</p>
          {sync.issues.map((issue, index) => <div key={`${issue.source}:${issue.title}:${index}`} className="border-b border-border py-2 text-xs">
            <div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate font-medium">{issue.entryId ? entryById.get(issue.entryId)?.title ?? issue.title : issue.title} · {issue.source === 'zotero' ? 'Zotero' : 'MinerU'}</p>
              {issue.entryId && entryById.has(issue.entryId) && <Button size="sm" variant="outline" onClick={() => { onOpenChange(false); onOpenEntry(issue.entryId!); }}>打开条目</Button>}
            </div>
            <p className="mt-1 text-muted-foreground">{issue.reason}</p>
          </div>)}
        </section>}
        {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}
      </DialogBody>
      <DialogFooter><Button variant="outline" onClick={sync.refresh} disabled={sync.running}>重新检查</Button><Button onClick={() => onOpenChange(false)}>完成</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function SourceChangeRow({ change, entry, busy, onOpen, onAcknowledge, onApplyTitle, onApplyField, onApplyPdfName }: {
  change: LibrarySourceChange;
  entry?: LibraryEntry;
  busy: boolean;
  onOpen: () => void;
  onAcknowledge: () => void;
  onApplyTitle: () => void;
  onApplyField: (key: string, value: string) => void;
  onApplyPdfName: (name: string) => void;
}) {
  const differingFields = Object.entries(change.sourceFields ?? {}).filter(([key, value]) => key !== 'title' && value && entry?.fields[key] !== value);
  return <article className="border-b border-border py-2 text-xs">
    <div className="flex min-w-0 items-start justify-between gap-3"><div className="min-w-0">
      <p className="truncate font-medium" title={change.sourceTitle}>{change.sourceTitle}</p>
      <p className="text-muted-foreground">{change.source === 'zotero' ? 'Zotero' : 'MinerU'} · NeuInk：{entry?.title ?? '本地条目暂不可用'}</p>
    </div><div className="flex shrink-0 gap-1"><Button size="sm" variant="outline" onClick={onOpen} disabled={!entry}>打开条目</Button><Button size="sm" variant="outline" onClick={onAcknowledge} disabled={!change.fingerprint || busy} title={change.fingerprint ? '确认已核对当前来源版本' : '来源版本不可用，请重新检查'}>已核对</Button></div></div>
    {change.source === 'zotero' ? <div className="mt-2 space-y-1 text-muted-foreground">
      {entry && change.sourceTitle !== entry.title && <p>标题：来源“{change.sourceTitle}” · 本地“{entry.title}”</p>}
      {differingFields.map(([key, value]) => <div key={key} className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate" title={`${key}: ${value}`}>{key}：来源“{value}” · 本地“{entry?.fields[key] || '空'}”</p><Button size="xs" variant="ghost" disabled={busy || !entry} onClick={() => onApplyField(key, value)}>采用</Button></div>)}
      <p>Zotero 分类和标签单独保留为只读信息，不与本地标签比较或合并；可在条目详情中选择添加到我的标签。</p>
      {change.sourcePdfName && entry?.pdfFileName !== change.sourcePdfName && <div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate">PDF 名称：来源“{change.sourcePdfName}” · 本地“{entry?.pdfFileName || '无'}”</p>{entry?.pdfFileName && <Button size="xs" variant="ghost" disabled={busy} onClick={() => onApplyPdfName(change.sourcePdfName!)}>采用名称</Button>}</div>}
      <p>来源快照包含标题、字段、标签、附件和笔记；这里展示当前可比较的差异，附件内容与笔记请在 Zotero 核对。</p>
    </div> : <div className="mt-2 text-muted-foreground"><p>MinerU 解析结果包内容变化；原结果与本地解析数据可能不同，请打开条目核对。</p>{change.sourcePath && <p className="break-all">来源：{change.sourcePath}</p>}</div>}
    {entry && change.source === 'zotero' && change.sourceTitle !== entry.title && <div className="mt-2 flex flex-wrap gap-2">
      {change.sourceTitle !== entry.title && <Button size="sm" variant="outline" disabled={busy} onClick={onApplyTitle}>采用来源标题</Button>}
    </div>}
  </article>;
}
