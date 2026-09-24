import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppearanceProvider } from '@/shared/components/AppearanceProvider';
import { AppearanceExit } from '@/shared/components/AppearanceExit';
import { SearchDialog } from '@/modules/search/components/SearchDialog';
import { ToastContext } from '@/shared/hooks/useToast';
import { ReaderSurfaceFrame } from '@/modules/reader/components/ReaderSurfaceFrame';
import { ReaderToolbar } from '@/modules/reader/components/pdf-reader/ReaderToolbar';
import { PdfReaderDocumentPane } from '@/modules/reader/components/pdf-reader/PdfReaderDocumentPane';
import { SegmentRailLayout } from '@/modules/reader/components/pdf-reader/SegmentRailLayout';
import { SegmentRail } from '@/modules/reader/components/pdf-reader/SegmentRail';
import { PDF_RAIL_WIDTH } from '@/modules/reader/components/pdf-reader/readerConstants';
import { usePdfDocument } from '@/modules/reader/components/pdf-reader/usePdfDocument';
import { usePdfViewportMetrics } from '@/modules/reader/components/pdf-reader/usePdfViewportMetrics';
import { usePdfTextSearch } from '@/modules/reader/components/pdf-reader/usePdfTextSearch';
import { groupSegmentsByPage, scrollToPage } from '@/modules/reader/components/pdf-reader/readerUtils';
import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';
import { ReadingSessionContext } from '@/modules/reader/parallel-reading/ReadingSessionContext';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { Annotation, SourceSegment } from '@/shared/types/domain';
import { SegmentAnnotationEditor } from '@/modules/annotations/components/SegmentAnnotationEditor';
import { createPdfPageAnnotationSegment } from '@/modules/reader/components/pdf-reader/pdfPageAnnotations';
import { readerPdfFixture } from './readerPdfFixture';
import { ReaderToolbarPreview } from './ReaderToolbarPreview';
import '../styles/globals.css';

const noop = () => undefined;
const entry: LibraryEntry = { id:'glass-fixture', title:'跨论文阅读：证据比较与来源追溯', contents:[], tagIds:[], tags:[], fields:{}, createdAt:'', updatedAt:'', pdfFileName:'reading-study.pdf', parseMessage:null, parseEndpoint:null, status:'Parsed', progress:100 };
// Isolated preview; no IPC operation reaches a user workspace.
mockIPC(async () => undefined, { shouldMockEvents:true });

function PdfPreview({ compact }: { compact: boolean }) {
  const bytes = useMemo(readerPdfFixture, []);
  const pdfState = usePdfDocument(bytes);
  const [mode, setMode] = useState<'ready'|'loading'|'error'>('ready');
  const [preferences, setPreferences] = useState(readStoredReaderPreferences);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [auxOpen, setAuxOpen] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState<SourceSegment | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>(() => [0, 1, 3].map((index, order) => ({
    annotation_id: `preview-note-${index}`, segment_uid: `pdf-page:${index}`, anchor_kind: 'pdf_page', kind: 'comment',
    content: ['这段提出了跨论文比较证据的方法。读完后，回到研究笔记整理不同来源的结论。', '这里需要进一步核对实验条件，再与其他论文比较。', '可以作为综述的讨论点，保留原始来源。'][order],
    importance: order === 2 ? 'core' : 'normal', created_at: '2026-09-16T08:00:00Z', updated_at: '2026-09-16T08:00:00Z',
    text_selection: { color: (['yellow', 'green', 'pink'] as const)[order], page_idx: index, rects: [[80, 218, 835, 235]], text: 'Evidence from multiple sources can be compared in a shared research note.' },
  })));
  const annotationsBySegmentUid = useMemo(() => {
    const groups = new Map<string, Annotation[]>();
    annotations.forEach(annotation => groups.set(annotation.segment_uid, [...(groups.get(annotation.segment_uid) ?? []), annotation]));
    return groups;
  }, [annotations]);
  const { pdfScrollRef, bindPdfScrollElement, pdfViewportWidth } = usePdfViewportMetrics({ notePaneOpen:auxOpen, segments:[] });
  const search = usePdfTextSearch(pdfState.document, page - 1);
  const pages = useMemo(() => groupSegmentsByPage([], 4), []);
  const dual = preferences.pageDisplayMode === 'dual' && !(preferences.pageTurningMode === 'book' && pdfViewportWidth < 860);
  const rows = useMemo(() => dual ? [pages.slice(0,2), pages.slice(2,4)] : pages.map(p => [p]), [dual, pages]);
  const goToPage = (next: number) => { setPage(next); scrollToPage(next - 1, pdfScrollRef.current); };
  useEffect(() => { if (search.activeMatch) scrollToPage(search.activeMatch.pageIdx, pdfScrollRef.current); }, [search.activeMatch, pdfScrollRef]);
  const shownState = mode === 'loading' ? {status:'loading' as const, document:null, error:null} : mode === 'error' ? {status:'error' as const, document:null, error:'示例：PDF 暂时无法读取，可重试。'} : pdfState;
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-2 px-3 py-1 text-xs"><span>PDF.js 真实渲染 · 4 页示例</span><Button size="xs" variant="plain" onClick={() => setMode(mode === 'ready' ? 'loading' : mode === 'loading' ? 'error' : 'ready')}>{mode === 'ready' ? '模拟加载' : mode === 'loading' ? '模拟失败' : '恢复正常'}</Button><Button size="xs" variant="plain" onClick={()=>setAuxOpen(v=>!v)}>笔记区域检查</Button></div>
    <ReadingSessionContext.Provider value={compact ? {active:true,onReady:noop} : null}>
      <ReaderSurfaceFrame className="pdf-reader-surface bg-muted/30" toolbar={<ReaderToolbar entry={entry} currentPage={page} effectivePageDisplayMode={dual ? 'dual' : 'single'} pageCount={4} segmentCount={0}
        readerPreferences={preferences} onReaderPreferencesChange={setPreferences} zoom={zoom} onZoomIn={() => setZoom(v => Math.min(2,v+.1))} onZoomOut={() => setZoom(v => Math.max(.5,v-.1))}
        recommendedTags={[]} selectedRecommendedTagPaths={[]} tagSuggestionBusy={false} tagSuggestionsOpen={false} translation={null} translationBusy={false}
        onCurrentPageChange={goToPage} onApplyRecommendedTags={noop} onDismissRecommendedTags={noop} onRecommendedTagToggle={noop} onTagSuggestionsOpenChange={noop}
        onExportTranslation={noop} onPauseTranslation={noop} onOpenTranslationTask={noop} onOpenPdf={noop}
        searchQuery={search.query} searchStatus={search.status} searchMatchCount={search.matches.length} searchActiveMatchNumber={search.activeMatchIndex+1}
        onSearchQueryChange={search.setQuery} onSearchNext={search.nextMatch} onSearchPrevious={search.previousMatch} />}>
        <div data-reader-body className="relative grid h-full min-h-0 min-w-0 overflow-hidden" style={{gridTemplateColumns:auxOpen?'minmax(0,1fr) 8px minmax(200px, 34%)':'minmax(0,1fr)',gridTemplateRows:'minmax(0,1fr)'}}>
          <SegmentRailLayout rail={<SegmentRail pages={pages} activeSegmentUid={null} flashSegmentUid={null} selectedSegmentUid={null} annotationsBySegmentUid={new Map()} notesBySegmentUid={new Map()} onJumpToSegment={noop}/>}>
          <PdfReaderDocumentPane entry={entry} pdfState={shownState} pdfBytesState={{status:'ready',bytes,error:null,retry:()=>setMode('ready')}} pdfAvailable
            bookMode={preferences.pageTurningMode === 'book'} zoom={zoom} resumePageIdx={1}
            pdfScrollRef={pdfScrollRef} bindPdfScrollElement={bindPdfScrollElement} rows={rows} leftInset={PDF_RAIL_WIDTH} pageWidth={Math.max(200,(pdfViewportWidth-40-PDF_RAIL_WIDTH)/(dual?2:1))*zoom}
            flashSegmentUid={null} hoveredSegmentUid={null} annotationsBySegmentUid={annotationsBySegmentUid} notesBySegmentUid={new Map()}
            hoverPreviewEnabled={false} hoverPreviewFontSize="standard" hoverPreviewSize="standard" hoverPreviewShowRegion={false} hoverPreviewShowOriginal={false}
            hoverPreviewShowNote={false} hoverPreviewShowAnnotation={false} hoverPreviewShowTranslation={false} showRegions={false} suppressRegions={false}
            sourceBacklinksBySegmentUid={{}} translationBySegmentUid={new Map()} translationStatus={null} translationMode="hover" translationVisible={false} workspaceRoot={null}
            onCtrlWheelZoom={({direction})=>setZoom(v=>Math.max(.5,Math.min(2,v+direction*.1)))} onOpenSegmentAnnotation={segment=>{setSelectedSegment(segment);setAuxOpen(true);}} onOpenSegmentNote={noop}
            onOpenSourceBacklink={noop} onCloseSegmentOverlay={noop} onCreateTextSelectionAnnotation={({content,importance,selection,segment})=>setAnnotations(current=>[...current,{
              annotation_id:crypto.randomUUID(),segment_uid:segment.uid,anchor_kind:'pdf_page',kind:'comment',content,importance,text_selection:selection,
              created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
            }])} onToggleSegment={noop}
            searchQuery={search.query} searchMatchCountsByPage={search.matchCountsByPage} activeSearchPageIdx={search.activeMatch?.pageIdx}
            onVisiblePageIndexesChange={indexes=>{if(indexes.length)setPage(indexes[0]+1);}} />
          </SegmentRailLayout>
          {auxOpen?<><div className="app-note-pane-resizer"/><aside data-reader-aux className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] border-l bg-card">
            {selectedSegment ? <SegmentAnnotationEditor annotations={annotations} busy={false} segment={selectedSegment}
              segments={annotations.map(a=>createPdfPageAnnotationSegment(a.text_selection!.page_idx,a.text_selection!.text,a.text_selection!.rects))}
              sourceEntryId={entry.id} workspaceRoot={null} onClose={()=>setAuxOpen(false)} onModeChange={noop}
              onDelete={id=>setAnnotations(current=>current.filter(a=>a.annotation_id!==id))}
              onSave={draft=>setAnnotations(current=>current.map(a=>a.annotation_id===draft.annotationId?{...a,content:draft.content,importance:draft.importance,kind:draft.kind}:a))}/>
              : <textarea aria-label="检查笔记草稿" className="min-h-0 w-full resize-none bg-card p-2" defaultValue="切换主题时保留草稿与输入焦点。此处只验证布局，不保存笔记。"/>}
          </aside></>:null}
        </div>
      </ReaderSurfaceFrame>
    </ReadingSessionContext.Provider>
  </div>;
}
function Showcase() {
  const [split,setSplit]=useState(false), [searchOpen,setSearchOpen]=useState(false), [scale,setScale]=useState(1);
  return <main data-material="app-background" className="flex h-screen flex-col">
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2"><Button size="sm" variant="outline" onClick={()=>setSearchOpen(true)}>搜索</Button><AppearanceExit/>
      <Button size="sm" variant="outline" onClick={()=>setSplit(v=>!v)}>{split?'单栏阅读':'双栏阅读'}</Button>
      <Button size="sm" variant="plain" onClick={()=>setScale(scale===1?1.25:1)}>{scale===1?'125%':'100%'}</Button>
      <span className="text-xs text-muted-foreground">滚动查看悬浮栏，支持翻页、缩放、查找和文字选择。</span></div>
    <div className="grid min-h-0 flex-1" style={{gridTemplateColumns:split?'1fr 1fr':'1fr',zoom:scale}}><PdfPreview compact={split}/>{split?<PdfPreview compact/>:null}</div>
    <SearchDialog open={searchOpen} root={null} status="ready" onOpenChange={setSearchOpen} onOpenResult={noop}/>
  </main>;
}
const root=createRoot(document.getElementById('root')!);
root.render(<AppearanceProvider><TooltipProvider><ToastContext.Provider value={{dismiss:noop,notify:()=> 'preview'}}>{new URLSearchParams(location.search).has('toolbar') ? <ReaderToolbarPreview/> : <Showcase/>}</ToastContext.Provider></TooltipProvider></AppearanceProvider>);
if(import.meta.hot) import.meta.hot.dispose(()=>root.unmount());
