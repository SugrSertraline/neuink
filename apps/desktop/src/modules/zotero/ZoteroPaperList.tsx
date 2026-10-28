import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ZoteroPaper } from '@/shared/ipc/zoteroApi';
import type { useZoteroImport } from './useZoteroImport';

export function ZoteroPaperList({ papers, model, onOpenEntry, onPreview }: {
  onPreview?: (paperId: string, attachmentKey: string, title: string) => void;
  papers: ZoteroPaper[]; model: ReturnType<typeof useZoteroImport>; onOpenEntry?: (id: string) => void;
}) {
  return <Table className="table-fixed text-xs">
    <TableHeader className="bg-muted"><TableRow><TableHead className="w-10"><span className="sr-only">选择</span></TableHead><TableHead>论文</TableHead><TableHead className="w-36">导入状态</TableHead></TableRow></TableHeader>
    <TableBody>{papers.map(paper => {
      const result = model.outcomes[paper.id];
      const existing = model.snapshot?.existing[paper.id] ?? result?.result?.entry_id;
      const picked = model.attachments[paper.id];
      const previewFile = paper.attachments.find(a => a.key === picked && a.available) ?? paper.attachments.find(a => a.available);
      const file = paper.attachments.find(a => a.key === picked);
      return <TableRow key={paper.id} data-state={model.selected.has(paper.id) ? 'selected' : undefined}>
        <TableCell className="align-top pt-3"><Checkbox aria-label={`选择 ${paper.title}`} checked={model.selected.has(paper.id)} disabled={model.busy || Boolean(existing)} onCheckedChange={checked => {
          model.setSelected(previous => { const next = new Set(previous); if (checked === true) next.add(paper.id); else next.delete(paper.id); return next; });
        }} /></TableCell>
        <TableCell className="min-w-0 py-2">
          <p className="truncate font-medium" title={paper.title}>{paper.title}</p>
          <p className="mt-1 truncate text-muted-foreground" title={`${paper.authors} · ${paper.library_name}`}>{[paper.authors || '作者未填写', paper.year, paper.library_name].filter(Boolean).join(' · ')}</p>
          {paper.tags.length > 0 && <p className="mt-1 truncate text-muted-foreground" title={paper.tags.join(' · ')}>标签：{paper.tags.join(' · ')}</p>}
          {!existing && paper.attachments.filter(a => a.available).length > 1 && <Select disabled={model.busy} value={picked ?? '__metadata'} onValueChange={key => model.setAttachments(previous => ({ ...previous, [paper.id]: key === '__metadata' ? null : key }))}>
            <SelectTrigger size="sm" className="mt-2 w-full min-w-0" aria-label={`选择 PDF：${paper.title}`}><SelectValue /></SelectTrigger>
            <SelectContent viewportAligned>{paper.attachments.filter(a => a.available).map(a => <SelectItem key={a.key} value={a.key}>{a.file_name}</SelectItem>)}<SelectItem value="__metadata">仅导入文献信息</SelectItem></SelectContent>
          </Select>}
          {!existing && file && paper.attachments.filter(a => a.available).length <= 1 && <p className="mt-1 truncate text-muted-foreground" title={file.file_name}>{file.file_name}</p>}
          {!existing && !file && <p className="mt-1 break-words text-muted-foreground">{paper.attachments[0]?.reason ?? '暂无本地 PDF'} · 仅导入信息</p>}
          {onPreview && <Button size="xs" variant="outline" className="mt-2" disabled={!previewFile} onClick={() => previewFile && onPreview(paper.id, previewFile.key, paper.title)}>预览 PDF</Button>}
        </TableCell>
        <TableCell className="whitespace-normal align-top py-2">
          {existing ? <div className="grid justify-items-start gap-1"><span className="text-success">{result?.result?.status === 'imported' ? '已导入' : '已在本地'}</span>{onOpenEntry && <Button size="xs" variant="outline" disabled={model.busy} onClick={() => onOpenEntry(existing)}>打开</Button>}</div>
            : result?.error ? <p role="alert" className="break-words text-destructive">{result.error}</p>
            : <span className="text-muted-foreground">{file ? '可导入 PDF' : '仅文献信息'}</span>}
        </TableCell>
      </TableRow>;
    })}</TableBody>
  </Table>;
}
