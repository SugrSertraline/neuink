import { open } from '@tauri-apps/plugin-dialog';
import { CopyPlus, Download, FilePlus2, FolderOpen, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/shared/hooks/useToast';
import type { LibraryEntry } from './LibrarySidebar';

export type EntryPdfHandlers = {
  onFetchPdf?: (entryId: string) => Promise<void> | void;
  onAttachPdf?: (entryId: string, path: string) => Promise<void> | void;
  onCreatePdfVersion?: (entryId: string, path: string) => Promise<void> | void;
  onImportMineruClientResult?: (entryId: string, path: string) => Promise<unknown> | unknown;
  onReparsePdf?: (entryId: string) => Promise<void> | void;
};

export function EntryPdfActions({ entry, onFetchPdf, onAttachPdf, onCreatePdfVersion, onImportMineruClientResult, onReparsePdf }: EntryPdfHandlers & { entry: LibraryEntry }) {
  const [action, setAction] = useState<'fetch' | 'pdf' | 'mineru' | 'reparse' | null>(null), [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { notify } = useToast();
  const busy = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const fetchPdf = async () => {
    if (busy.current || !onFetchPdf || entry.pdfFileName) return;
    busy.current = true; setAction('fetch'); setError(null);
    try { await onFetchPdf(entry.id); }
    catch (caught) { if (live.current) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { busy.current = false; if (live.current) setAction(null); }
  };
  const reparse = async () => {
    if (busy.current || !onReparsePdf || entry.status !== 'Parsed') return;
    busy.current = true; setAction('reparse'); setError(null);
    try {
      await onReparsePdf(entry.id);
      if (live.current) {
        setConfirmOpen(false);
        notify({ title: '已加入解析队列', description: '可在左侧条目库的解析队列中查看进度、调整等待顺序。' });
      }
    } catch (caught) { if (live.current) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { busy.current = false; if (live.current) setAction(null); }
  };
  const choose = async (kind: 'pdf' | 'mineru', directory = false) => {
    const handler = kind === 'mineru' ? onImportMineruClientResult : entry.pdfFileName ? onCreatePdfVersion : onAttachPdf;
    if (busy.current || !handler) return;
    busy.current = true; setAction(kind); setError(null);
    try {
      const selected = await open(directory
        ? { multiple: false, directory: true }
        : { multiple: false, directory: false, filters: kind === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'MinerU 客户端结果', extensions: ['zip', 'rar'] }] });
      if (typeof selected === 'string' && live.current) await handler(entry.id, selected);
    } catch (caught) { if (live.current) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { busy.current = false; if (live.current) setAction(null); }
  };
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      {!entry.pdfFileName && onFetchPdf ? <Button size="sm" disabled={action !== null} onClick={() => void fetchPdf()}>
        {action === 'fetch' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
        {action === 'fetch' ? '正在获取 PDF…' : '获取 PDF'}
      </Button> : null}
      {entry.pdfFileName && entry.status === 'Parsed' && onReparsePdf ? <Button variant="outline" size="sm" disabled={action !== null} onClick={() => { setError(null); setConfirmOpen(true); }}>
        <RotateCcw size={14} aria-hidden="true" />重新解析 PDF
      </Button> : null}
      {(entry.pdfFileName ? onCreatePdfVersion : onAttachPdf) ? <Button variant="outline" size="sm" disabled={action !== null} onClick={() => void choose('pdf')}>
        {action === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : entry.pdfFileName ? <CopyPlus size={14} /> : <FilePlus2 size={14} />}
        {entry.pdfFileName ? '创建新版 PDF' : '上传 PDF'}
      </Button> : null}
      {entry.pdfFileName && onImportMineruClientResult ? <Button variant="outline" size="sm" disabled={action !== null} onClick={() => void choose('mineru')}>
        {action === 'mineru' ? <Loader2 size={14} className="animate-spin" /> : <FilePlus2 size={14} />}导入 MinerU ZIP/RAR
      </Button> : null}
      {entry.pdfFileName && onImportMineruClientResult ? <Button variant="outline" size="sm" disabled={action !== null} onClick={() => void choose('mineru', true)}>
        <FolderOpen size={14} />选择解析结果目录
      </Button> : null}
    </div>
    <p className="text-xs text-muted-foreground">{entry.pdfFileName ? '新版 PDF 会创建独立条目，保留原论文、笔记与来源链接。' : onFetchPdf ? '在线查找并保存到当前条目，也可以上传本地 PDF。' : '选择 PDF 后导入到当前条目并开始解析。'}</p>
    {action === 'fetch' ? <p role="status" className="text-xs text-muted-foreground">正在查找可下载的原文，可切换页面，在任务列表中查看结果。</p> : null}
    {entry.pdfFileName && onImportMineruClientResult ? <p className="text-xs text-muted-foreground">MinerU 结果会替换当前解析结果，PDF 文件保持不变。</p> : null}
    {error && !confirmOpen ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!busy.current) setConfirmOpen(open); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>确认重新解析</DialogTitle><DialogDescription>将重新调用解析服务处理当前 PDF，并覆盖现有解析结果。已有的解析正文、片段和相关内容可能发生变化。</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={action !== null} onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button variant="destructive" disabled={action !== null || entry.status !== 'Parsed'} onClick={() => void reparse()}>{action === 'reparse' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}确认重新解析</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
