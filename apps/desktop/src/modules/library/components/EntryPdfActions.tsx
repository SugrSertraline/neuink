import { open } from '@tauri-apps/plugin-dialog';
import { CopyPlus, FilePlus2, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { LibraryEntry } from './LibrarySidebar';

export type EntryPdfHandlers = {
  onAttachPdf?: (entryId: string, path: string) => Promise<void> | void;
  onCreatePdfVersion?: (entryId: string, path: string) => Promise<void> | void;
  onImportMineruClientResult?: (entryId: string, path: string) => Promise<unknown> | unknown;
};

export function EntryPdfActions({ entry, onAttachPdf, onCreatePdfVersion, onImportMineruClientResult }: EntryPdfHandlers & { entry: LibraryEntry }) {
  const [action, setAction] = useState<'pdf' | 'mineru' | null>(null), [error, setError] = useState<string | null>(null);
  const busy = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const choose = async (kind: 'pdf' | 'mineru') => {
    const handler = kind === 'mineru' ? onImportMineruClientResult : entry.pdfFileName ? onCreatePdfVersion : onAttachPdf;
    if (busy.current || !handler) return;
    busy.current = true; setAction(kind); setError(null);
    try {
      const selected = await open({ multiple: false, directory: false, filters: kind === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'MinerU 客户端结果', extensions: ['zip'] }] });
      if (typeof selected === 'string' && live.current) await handler(entry.id, selected);
    } catch (caught) { if (live.current) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { busy.current = false; if (live.current) setAction(null); }
  };
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      {(entry.pdfFileName ? onCreatePdfVersion : onAttachPdf) ? <Button variant="outline" size="sm" disabled={action !== null} onClick={() => void choose('pdf')}>
        {action === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : entry.pdfFileName ? <CopyPlus size={14} /> : <FilePlus2 size={14} />}
        {entry.pdfFileName ? '创建新版 PDF' : '上传 PDF'}
      </Button> : null}
      {entry.pdfFileName && onImportMineruClientResult ? <Button variant="outline" size="sm" disabled={action !== null} onClick={() => void choose('mineru')}>
        {action === 'mineru' ? <Loader2 size={14} className="animate-spin" /> : <FilePlus2 size={14} />}导入客户端解析结果
      </Button> : null}
    </div>
    <p className="text-xs text-muted-foreground">{entry.pdfFileName ? '新版 PDF 会创建独立条目，保留原论文、笔记与来源链接。' : '选择 PDF 后导入到当前条目并开始解析。'}</p>
    {entry.pdfFileName && onImportMineruClientResult ? <p className="text-xs text-muted-foreground">客户端 ZIP 会替换当前解析结果，PDF 文件保持不变。</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}
