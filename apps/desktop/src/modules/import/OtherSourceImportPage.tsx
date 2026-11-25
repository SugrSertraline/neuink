import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MineruImportDialog } from '@/modules/mineru/MineruImportDialog';
import { ZoteroImportDialog } from '@/modules/zotero/ZoteroImportDialog';
import type { ImportPreviewRequest } from '@/shared/ipc/importPreviewApi';

const ImportPdfPreview = lazy(() => import('./ImportPdfPreview').then(module => ({ default: module.ImportPdfPreview })));
const noop = () => {};

type ImportSource = 'zotero' | 'mineru';

export function OtherSourceImportPage({ root, scope = 'external-import', requestedSource, sourceRequestId, enabledSources = { zotero: true, mineru: true }, onImported, onOpenEntry, onBusyChange }: {
  onBusyChange?: (busy: boolean) => void;
  requestedSource?: ImportSource; sourceRequestId?: string;
  enabledSources?: { zotero: boolean; mineru: boolean };
  root: string; scope?: string; onImported?: () => Promise<void> | void; onOpenEntry?: (id: string) => void;
}) {
  const [source, setSource] = useState<ImportSource>(requestedSource ?? 'zotero');
  // Mount each source on its first visit, then retain its filters, selection and scroll.
  const [visited, setVisited] = useState(new Set([requestedSource ?? 'zotero']));
  const [zoteroBusy, setZoteroBusy] = useState(false);
  const [mineruBusy, setMineruBusy] = useState(false);
  const [preview, setPreview] = useState<{ request: ImportPreviewRequest; title: string } | null>(null);
  const activeSource = enabledSources[source] ? source : enabledSources.zotero ? 'zotero' : enabledSources.mineru ? 'mineru' : null;
  const handledSourceRequestId = useRef(sourceRequestId);
  useEffect(() => { onBusyChange?.(zoteroBusy || mineruBusy); }, [onBusyChange, zoteroBusy, mineruBusy]);
  useEffect(() => {
    if (!requestedSource || !enabledSources[requestedSource] || !sourceRequestId || sourceRequestId === handledSourceRequestId.current || zoteroBusy || mineruBusy) return;
    handledSourceRequestId.current = sourceRequestId;
    setSource(requestedSource);
    setVisited(previous => new Set([...previous, requestedSource]));
    setPreview(null);
  }, [requestedSource, sourceRequestId, zoteroBusy, mineruBusy, enabledSources.zotero, enabledSources.mineru]);
  useEffect(() => {
    if (activeSource) setVisited(previous => previous.has(activeSource) ? previous : new Set([...previous, activeSource]));
    if (preview && !activeSource) setPreview(null);
  }, [activeSource, preview]);
  const onPreview = useCallback((request: ImportPreviewRequest, title: string) => setPreview({ request, title }), []);
  return <div className="@container/import-page flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card">
    <h1 className="shrink-0 px-4 pt-4 text-base font-semibold">从其他来源导入</h1>
    {!activeSource ? <p role="status" className="p-4 text-sm text-muted-foreground">Zotero 和 MinerU 来源已关闭。请在设置中启用来源后导入。</p> : <Tabs value={activeSource} onValueChange={value => { const nextSource = value as ImportSource; setSource(nextSource); setVisited(previous => new Set([...previous, nextSource])); setPreview(null); }} className="min-h-0 min-w-0 flex-1 gap-0">
      <div className="shrink-0 border-b border-border px-4 py-3"><TabsList aria-label="导入来源">
        {enabledSources.zotero && <TabsTrigger value="zotero" disabled={zoteroBusy || mineruBusy}>Zotero</TabsTrigger>}
        {enabledSources.mineru && <TabsTrigger value="mineru" disabled={zoteroBusy || mineruBusy}>MinerU</TabsTrigger>}
      </TabsList></div>
      <div className={`grid min-h-0 min-w-0 flex-1 ${preview ? 'grid-cols-1 grid-rows-2 @min-[900px]/import-page:grid-cols-2 @min-[900px]/import-page:grid-rows-1' : 'grid-cols-1'}`}>
        <div className="min-h-0 min-w-0 overflow-hidden">
          {enabledSources.zotero && <TabsContent value="zotero" hidden={activeSource !== 'zotero'} forceMount className="h-full min-h-0 min-w-0">
            {visited.has('zotero') && <ZoteroImportDialog embedded active={activeSource === 'zotero'} root={root} scope={scope} onClose={noop} onOpenEntry={onOpenEntry} onBusyChange={setZoteroBusy} onPreview={onPreview} />}
          </TabsContent>}
          {enabledSources.mineru && <TabsContent value="mineru" hidden={activeSource !== 'mineru'} forceMount className="h-full min-h-0 min-w-0">
            {visited.has('mineru') && <MineruImportDialog embedded active={activeSource === 'mineru'} root={root} scope={scope} onClose={noop} onImported={onImported} onOpenEntry={onOpenEntry} onBusyChange={setMineruBusy} onPreview={onPreview} />}
          </TabsContent>}
        </div>
        {preview && <Suspense fallback={<p role="status" className="p-4 text-sm">正在加载预览…</p>}>
          <ImportPdfPreview key={JSON.stringify(preview.request)} request={preview.request} title={preview.title} onClose={() => setPreview(null)} />
        </Suspense>}
      </div>
    </Tabs>}
  </div>;
}
