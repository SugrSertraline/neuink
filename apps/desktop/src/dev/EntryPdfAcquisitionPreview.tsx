import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EntryOverview } from '@/modules/reader/components/EntryOverview';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

const original: LibraryEntry = {
  id:'pdf-acquisition-preview', title:'The financial cycle and macroeconomics: What have we learnt?',
  fields:{ 作者:'Claudio Borio', 发表年份:'2014', 来源平台:'Sciverse' }, contents:[], tagIds:[], tags:[],
  createdAt:'2026-10-10T00:00:00Z', updatedAt:'2026-10-10T00:00:00Z',
  pdfFileName:null, parseMessage:null, parseEndpoint:null, status:'No PDF', progress:0
};

/** Isolated UI verification, never reads or writes the local library. */
export function EntryPdfAcquisitionPreview() {
  const [entry, setEntry] = useState(original);
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void }>();
  const [active, setActive] = useState(false);
  return <main className="flex h-screen flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-2 text-xs">
      <span>详情页交互检查 · 模拟下载</span>
      <Button size="xs" variant="outline" disabled={!active} onClick={() => { pending.current?.reject(new Error('暂未找到可下载的 PDF，请稍后重试或上传本地文件。')); setActive(false); }}>模拟获取失败</Button>
      <Button size="xs" variant="outline" disabled={!active} onClick={() => {
        setEntry({ ...original, pdfFileName:'paper.pdf', status:'Not started', fields:{ ...original.fields, 'PDF 来源':'https://www.bis.org/publ/work395.pdf', 'PDF 获取方式':'开放获取版本（可能与期刊排版不同）' } });
        pending.current?.resolve(); setActive(false);
      }}>模拟获取成功</Button>
      <Button size="xs" variant="outline" disabled={active} onClick={() => setEntry(original)}>恢复无 PDF</Button>
    </div>
    <EntryOverview entry={entry} tags={[]} sourceBacklinksBySegmentUid={{}} onOpenContent={() => undefined}
      onUpdateEntry={() => undefined} onAttachPdf={() => undefined}
      onFetchPdf={() => { setActive(true); return new Promise<void>((resolve, reject) => { pending.current = { resolve, reject }; }); }} />
  </main>;
}
