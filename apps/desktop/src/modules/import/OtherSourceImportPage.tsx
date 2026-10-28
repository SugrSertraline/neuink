import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MineruImportDialog } from '@/modules/mineru/MineruImportDialog';
import { ZoteroImportDialog } from '@/modules/zotero/ZoteroImportDialog';
import type { ImportPreviewRequest } from '@/shared/ipc/importPreviewApi';

const ImportPdfPreview = lazy(() => import('./ImportPdfPreview').then(module => ({ default: module.ImportPdfPreview })));
const noop = () => {};

export function OtherSourceImportPage({ root, scope = 'external-import', onImported, onOpenEntry, onBusyChange }: {
  onBusyChange?: (busy: boolean) => void;
  root: string; scope?: string; onImported?: () => Promise<void> | void; onOpenEntry?: (id: string) => void;
}) {
  const [source, setSource] = useState('zotero');
  // Mount each source on its first visit, then retain its filters, selection and scroll.
  const [visited, setVisited] = useState(new Set(['zotero']));
  const [zoteroBusy, setZoteroBusy] = useState(false);
  const [mineruBusy, setMineruBusy] = useState(false);
  useEffect(() => { onBusyChange?.(zoteroBusy || mineruBusy); }, [onBusyChange, zoteroBusy, mineruBusy]);
  const [preview, setPreview] = useState<{ request: ImportPreviewRequest; title: string } | null>(null);
  const onPreview = useCallback((request: ImportPreviewRequest, title: string) => setPreview({ request, title }), []);
  return <div className="@container/import-page flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <h1 className="shrink-0 px-4 pt-4 text-base font-semibold">从其他来源导入</h1>
    <Tabs value={source} onValueChange={value => { setSource(value); setVisited(previous => new Set([...previous, value])); setPreview(null); }} className="min-h-0 min-w-0 flex-1 gap-0">
      <div className="shrink-0 border-b border-border px-4 py-3"><TabsList aria-label="导入来源">
        <TabsTrigger value="zotero" disabled={zoteroBusy || mineruBusy}>Zotero</TabsTrigger>
        <TabsTrigger value="mineru" disabled={zoteroBusy || mineruBusy}>MinerU</TabsTrigger>
      </TabsList></div>
      <div className={`grid min-h-0 min-w-0 flex-1 ${preview ? 'grid-cols-1 grid-rows-2 @min-[900px]/import-page:grid-cols-2 @min-[900px]/import-page:grid-rows-1' : 'grid-cols-1'}`}>
        <div className="min-h-0 min-w-0 overflow-hidden">
          <TabsContent value="zotero" hidden={source !== 'zotero'} forceMount className="h-full min-h-0 min-w-0">
            <ZoteroImportDialog embedded root={root} scope={scope} onClose={noop} onOpenEntry={onOpenEntry} onBusyChange={setZoteroBusy} onPreview={onPreview} />
          </TabsContent>
          <TabsContent value="mineru" hidden={source !== 'mineru'} forceMount className="h-full min-h-0 min-w-0">
            {visited.has('mineru') && <MineruImportDialog embedded root={root} scope={scope} onClose={noop} onImported={onImported} onOpenEntry={onOpenEntry} onBusyChange={setMineruBusy} onPreview={onPreview} />}
          </TabsContent>
        </div>
        {preview && <Suspense fallback={<p role="status" className="p-4 text-sm">正在加载预览…</p>}>
          <ImportPdfPreview key={JSON.stringify(preview.request)} request={preview.request} title={preview.title} onClose={() => setPreview(null)} />
        </Suspense>}
      </div>
    </Tabs>
  </div>;
}
