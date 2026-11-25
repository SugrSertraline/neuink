import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PdfCanvasPage } from '@/modules/reader/components/pdf-reader/PdfCanvasPage';
import { usePdfDocument } from '@/modules/reader/components/pdf-reader/usePdfDocument';
import { readImportPreview, type ImportPreviewRequest } from '@/shared/ipc/importPreviewApi';

export function ImportPdfPreview({ request, title, onClose }: { request: ImportPreviewRequest; title: string; onClose: () => void }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(0);
  const [width, setWidth] = useState(400);
  const viewport = useRef<HTMLDivElement>(null);
  const pdf = usePdfDocument(bytes);
  useEffect(() => {
    let current = true;
    setBytes(null); setError(''); setPage(0);
    void readImportPreview(request).then(value => { if (current) setBytes(value); }).catch(reason => {
      if (current) setError(typeof reason === 'string' ? reason : '无法读取 PDF，请刷新来源列表后重试。');
    });
    return () => { current = false; };
  }, [request, attempt]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(1, element.clientWidth - 32)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; }, [page]);
  const message = error || (pdf.status === 'error' ? pdf.error : '');
  return <aside aria-label="PDF 预览" className="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-border @min-[900px]/import-page:border-l @min-[900px]/import-page:border-t-0">
    <div className="flex shrink-0 items-center gap-2 border-b border-border p-3"><span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>{title}</span><Button size="xs" variant="ghost" onClick={onClose}>关闭预览</Button></div>
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-b border-border p-2 text-xs">
      <Button size="xs" variant="outline" disabled={pdf.status !== 'ready' || page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button>
      <span>{pdf.status === 'ready' ? `${page + 1} / ${pdf.document.numPages}` : 'PDF 预览'}</span>
      <Button size="xs" variant="outline" disabled={pdf.status !== 'ready' || page + 1 >= pdf.document.numPages} onClick={() => setPage(value => value + 1)}>下一页</Button>
    </div>
    <div ref={viewport} className="search-result-scrollbar min-h-0 min-w-0 flex-1 overflow-auto bg-muted p-4">
      {message ? <div role="alert" className="space-y-3 text-sm"><p className="break-words text-destructive">{message}</p><Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>重试预览</Button></div>
        : pdf.status === 'ready' ? <PdfCanvasPage pageIdx={page} pageWidth={width} pdfDocument={pdf.document} renderEnabled renderPriority="visible" />
          : <p role="status" className="text-sm text-muted-foreground">正在读取 PDF…</p>}
    </div>
  </aside>;
}
