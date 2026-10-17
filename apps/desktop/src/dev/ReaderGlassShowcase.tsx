import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PdfBlockComposerPreview } from './PdfBlockComposerPreview';
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
import { groupSegmentsByPage, scrollToPage, scrollToSegment } from '@/modules/reader/components/pdf-reader/readerUtils';
import { usePdfSourceJump } from '@/modules/reader/components/pdf-reader/usePdfSourceJump';
import { usePdfSegmentNavigation } from '@/modules/reader/components/pdf-reader/usePdfSegmentNavigation';
import { findSourceSegment } from '@/shared/lib/listItemSegments';
import type { PdfJumpRequest } from '@/modules/reader/types';
import { readingAssistantContext } from '@/modules/reader/components/readingAssistantContext';
import type { AssistantContextInput, AssistantContextItem } from '@/shared/types/assistant';
import { readStoredReaderPreferences } from '@/shared/lib/readerPreferences';
import { ReadingSessionContext } from '@/modules/reader/parallel-reading/ReadingSessionContext';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { Annotation, SourceSegment } from '@/shared/types/domain';
import { SegmentAnnotationEditor } from '@/modules/annotations/components/SegmentAnnotationEditor';
import { createPdfPageAnnotationSegment } from '@/modules/reader/components/pdf-reader/pdfPageAnnotations';
import { readerPdfFixture } from './readerPdfFixture';
import { ReaderToolbarPreview } from './ReaderToolbarPreview';
import { EntryPdfAcquisitionPreview } from './EntryPdfAcquisitionPreview';
import { NoteImageResizePreview } from './NoteImageResizePreview';
import { ArrayMathPreview } from './ArrayMathPreview';
import { ReadingStateRetention } from '@/modules/reader/components/navigation/ReadingStateRetention';
import { ReadingNavigationScope, useReadingNavigation } from '@/modules/reader/components/navigation/ReadingNavigation';
import { usePdfReadingNavigation } from '@/modules/reader/components/navigation/usePdfReadingNavigation';
import '../styles/globals.css';

const noop = () => undefined;
const interactionCheck = new URLSearchParams(location.search).has('interactions');
const localPaperCheck = new URLSearchParams(location.search).has('local-paper');
const blockDragCheck = new URLSearchParams(location.search).has('block-drag');
const listItemsCheck = new URLSearchParams(location.search).has('list-items');
const resumeCheck = new URLSearchParams(location.search).has('session-resume');
type LocalPaper = { bytes: Uint8Array; segments: SourceSegment[] };
const sampleLines = [
  'Evidence from multiple sources can be compared in a shared research note.',
  'Keep the original document readable while navigating between papers.',
  'Select text, search within the PDF, and keep your current reading position.',
];
// Match the original fixture's PDF coordinates so hover and native text share a surface.
const interactionSegments: SourceSegment[] = Array.from({ length: 4 }, (_, page_idx) =>
  Array.from({ length: 5 }, (_, group) => ({
    uid: `interaction-${page_idx}-${group}`, page_idx, segment_type: 'paragraph', markdown: null,
    text: sampleLines.slice(0, group === 4 ? 2 : 3).join(' '),
    bbox: [80, ((179 + group * 72) / 842) * 1000, 850, ((242 + group * 72) / 842) * 1000],
  } as SourceSegment))).flat();
const listInteractionSegments: SourceSegment[] = interactionSegments.map(segment => ({ ...segment,
  segment_type: 'list', text: sampleLines.join('\n'), markdown: sampleLines.map(line => `- ${line}`).join('\n'),
  mineru_metadata: { list_item_regions: JSON.stringify(sampleLines.map((text, index) => ({ text,
    bbox: [80, segment.bbox![1] + index * 24 / 842 * 1000, 850, segment.bbox![1] + (index * 24 + 17) / 842 * 1000] }))) },
}));
const entry: LibraryEntry = { id:'glass-fixture', title:'跨论文阅读：证据比较与来源追溯', contents:[], tagIds:[], tags:[], fields:{}, createdAt:'', updatedAt:'', pdfFileName:'reading-study.pdf', parseMessage:null, parseEndpoint:null, status:'Parsed', progress:100 };
// Isolated preview; no IPC operation reaches a user workspace.
mockIPC(async () => undefined, { shouldMockEvents:true });

type PdfPreviewProps = { compact: boolean; paper?: LocalPaper; jumpRequest?: PdfJumpRequest | null; onAddContext?: (item: AssistantContextInput) => void; viewId?: string };
function PdfPreview(props: PdfPreviewProps) {
  return resumeCheck ? <ReadingStateRetention storageKey={`neuink.preview.reading:${props.viewId ?? 'left'}`}>
    <ReadingNavigationScope retentionKey="preview-pdf"><PdfPreviewBody {...props} /></ReadingNavigationScope>
  </ReadingStateRetention> : <PdfPreviewBody {...props} />;
}
function PdfPreviewBody({ compact, paper, jumpRequest = null, onAddContext }: PdfPreviewProps) {
  const navigation = useReadingNavigation();
  const bytes = useMemo(() => paper?.bytes ?? readerPdfFixture(), [paper]);
  const previewEntry = useMemo(() => paper ? { ...entry, title: 'Attention Is All You Need', pdfFileName: 'attention-is-all-you-need.pdf' } : entry, [paper]);
  const pdfState = usePdfDocument(bytes);
  const [mode, setMode] = useState<'ready'|'loading'|'error'>('ready');
  const [preferences, setPreferences] = useState(readStoredReaderPreferences);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [auxOpen, setAuxOpen] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState<SourceSegment | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>(() => (paper ? [] : [0, 1, 3]).map((index, order) => ({
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
  const pageCount = pdfState.document?.numPages ?? 4;
  const pages = useMemo(() => groupSegmentsByPage(paper?.segments ?? (listItemsCheck ? listInteractionSegments : interactionCheck ? interactionSegments : []), pageCount), [paper, pageCount]);
  const dual = preferences.pageDisplayMode === 'dual' && !(preferences.pageTurningMode === 'book' && pdfViewportWidth < 860);
  const rows = useMemo(() => dual ? Array.from({ length: Math.ceil(pages.length / 2) }, (_, index) => pages.slice(index * 2, index * 2 + 2)) : pages.map(p => [p]), [dual, pages]);
  usePdfReadingNavigation(pdfScrollRef, paper?.segments ?? interactionSegments, pdfState.status === 'ready', noop, { value: zoom, restore: setZoom });
  const goToPage = (next: number) => { navigation?.beginUserNavigation(); setPage(next); scrollToPage(next - 1, pdfScrollRef.current); };
  const { scrollToMountedOrPendingSegment, flashSegmentUid } = usePdfSegmentNavigation({
    entryId: previewEntry.id, entryTitle: previewEntry.title, layoutVersion: rows.length, pdfScrollRef,
  });
  usePdfSourceJump({ entryId: previewEntry.id, request: jumpRequest, ready: pdfState.status === 'ready',
    navigate: request => {
      const segment = request.kind === 'page' ? undefined : findSourceSegment(paper?.segments ?? (listItemsCheck ? listInteractionSegments : interactionSegments), request.segmentUid);
      if (segment) scrollToMountedOrPendingSegment(segment);
      else scrollToPage(request.pageIdx, pdfScrollRef.current);
      return true;
    } });
  useEffect(() => { if (search.activeMatch) scrollToPage(search.activeMatch.pageIdx, pdfScrollRef.current); }, [search.activeMatch, pdfScrollRef]);
  const shownState = mode === 'loading' ? {status:'loading' as const, document:null, error:null} : mode === 'error' ? {status:'error' as const, document:null, error:'示例：PDF 暂时无法读取，可重试。'} : pdfState;
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-2 px-3 py-1 text-xs"><span>PDF.js 真实渲染 · {paper ? '本机教学论文（批注仅存内存）' : '4 页示例'}</span><Button size="xs" variant="plain" onClick={() => setMode(mode === 'ready' ? 'loading' : mode === 'loading' ? 'error' : 'ready')}>{mode === 'ready' ? '模拟加载' : mode === 'loading' ? '模拟失败' : '恢复正常'}</Button><Button size="xs" variant="plain" onClick={()=>setAuxOpen(v=>!v)}>笔记区域检查</Button></div>
    <ReadingSessionContext.Provider value={compact ? {active:true,onReady:noop} : null}>
      <ReaderSurfaceFrame className="pdf-reader-surface bg-muted/30" toolbar={<ReaderToolbar entry={previewEntry} currentPage={page} effectivePageDisplayMode={dual ? 'dual' : 'single'} pageCount={pageCount} segmentCount={pages.reduce((sum, page) => sum + page.regions.length, 0)}
        readerPreferences={preferences} onReaderPreferencesChange={setPreferences} zoom={zoom} onZoomIn={() => setZoom(v => Math.min(2,v+.1))} onZoomOut={() => setZoom(v => Math.max(.5,v-.1))}
        recommendedTags={[]} selectedRecommendedTagPaths={[]} tagSuggestionBusy={false} tagSuggestionsOpen={false} translation={null} translationBusy={false}
        onCurrentPageChange={goToPage} onApplyRecommendedTags={noop} onDismissRecommendedTags={noop} onRecommendedTagToggle={noop} onTagSuggestionsOpenChange={noop}
        onExportTranslation={noop} onPauseTranslation={noop} onOpenTranslationTask={noop} onOpenPdf={noop}
        searchQuery={search.query} searchStatus={search.status} searchMatchCount={search.matches.length} searchActiveMatchNumber={search.activeMatchIndex+1}
        onSearchQueryChange={search.setQuery} onSearchNext={search.nextMatch} onSearchPrevious={search.previousMatch} />}>
        <div data-reader-body className="relative grid h-full min-h-0 min-w-0 overflow-hidden" style={{gridTemplateColumns:auxOpen?'minmax(0,1fr) 8px minmax(200px, 34%)':'minmax(0,1fr)',gridTemplateRows:'minmax(0,1fr)'}}>
          <SegmentRailLayout rail={<SegmentRail pages={pages} activeSegmentUid={null} flashSegmentUid={null} selectedSegmentUid={null} annotationsBySegmentUid={new Map()} notesBySegmentUid={new Map()} onJumpToSegment={noop}/>}>
          <PdfReaderDocumentPane entry={previewEntry} pdfState={shownState} pdfBytesState={{status:'ready',bytes,error:null,retry:()=>setMode('ready')}} pdfAvailable
            bookMode={preferences.pageTurningMode === 'book'} zoom={zoom} resumePageIdx={1}
            pdfScrollRef={pdfScrollRef} bindPdfScrollElement={bindPdfScrollElement} rows={rows} leftInset={PDF_RAIL_WIDTH} pageWidth={Math.max(200,(pdfViewportWidth-40-PDF_RAIL_WIDTH)/(dual?2:1))*zoom}
            flashSegmentUid={flashSegmentUid} hoveredSegmentUid={null} annotationsBySegmentUid={annotationsBySegmentUid} notesBySegmentUid={new Map()}
            hoverPreviewEnabled={interactionCheck} hoverPreviewFontSize="standard" hoverPreviewSize="standard" hoverPreviewShowRegion={interactionCheck} hoverPreviewShowOriginal={interactionCheck}
            hoverPreviewShowNote={false} hoverPreviewShowAnnotation={false} hoverPreviewShowTranslation={false} showRegions={blockDragCheck} suppressRegions={false}
            inlineAnnotationHoverEnabled={false}
            sourceBacklinksBySegmentUid={{}} translationBySegmentUid={new Map()} translationStatus={null} translationMode="hover" translationVisible={false} workspaceRoot={null}
            onCtrlWheelZoom={({direction})=>setZoom(v=>Math.max(.5,Math.min(2,v+direction*.1)))} onOpenSegmentAnnotation={segment=>{setSelectedSegment(segment);setAuxOpen(true);}} onOpenSegmentNote={noop}
            onOpenSourceBacklink={noop} onCloseSegmentOverlay={noop} onCreateTextSelectionAnnotation={({content,importance,selection,segment})=>setAnnotations(current=>[...current,{
              annotation_id:crypto.randomUUID(),segment_uid:segment.uid,anchor_kind:'pdf_page',kind:'comment',content,importance,text_selection:selection,
              created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
            }])} onToggleSegment={noop}
            onAddAssistantContext={blockDragCheck ? (segment, options) => onAddContext?.(readingAssistantContext(previewEntry, segment, options)) : undefined}
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
  const [paper, setPaper] = useState<LocalPaper>();
  const [paperError, setPaperError] = useState('');
  const [jumpRequest, setJumpRequest] = useState<PdfJumpRequest | null>(null);
  const [contexts, setContexts] = useState<AssistantContextItem[]>([]);
  const addContext = (item: AssistantContextInput) => setContexts(current => {
    const id = item.id ?? (item.kind === 'segment' ? `segment:${item.entryId}:${item.segmentUid}` : `entry:${item.entryId}`);
    return current.some(existing => existing.id === id) ? current : [...current, { ...item, id, addedAt: '' }];
  });
  useEffect(() => {
    if (!localPaperCheck) return;
    const controller = new AbortController();
    void Promise.all(['attention-is-all-you-need.pdf', 'segments.json'].map(async file => {
      const response = await fetch(`/src-tauri/resources/onboarding/${file}`, { signal: controller.signal });
      if (!response.ok) throw new Error('本机教学论文资源不可用');
      return response;
    })).then(async ([pdf, segments]) => {
      const loaded = { bytes: new Uint8Array(await pdf.arrayBuffer()), segments: await segments.json() as SourceSegment[] };
      if (!Array.isArray(loaded.segments)) throw new Error('本机解析数据格式无效');
      if (!controller.signal.aborted) setPaper(loaded);
    }).catch(error => { if (!controller.signal.aborted) setPaperError(String(error)); });
    return () => controller.abort();
  }, []);
  if (localPaperCheck && !paper) return <p role="status">{paperError || '正在读取本机教学论文…'}</p>;
  return <main data-material="app-background" className="flex h-screen flex-col">
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2"><Button size="sm" variant="outline" onClick={()=>setSearchOpen(true)}>搜索</Button><AppearanceExit/>
      <Button size="sm" variant="outline" onClick={()=>setSplit(v=>!v)}>{split?'单栏阅读':'双栏阅读'}</Button>
      <Button size="sm" variant="plain" onClick={()=>setScale(scale===1?1.25:1)}>{scale===1?'125%':'100%'}</Button>
      <span className="text-xs text-muted-foreground">滚动查看悬浮栏，支持翻页、缩放、查找和文字选择。</span></div>
    <div className="grid min-h-0 flex-1" style={{gridTemplateColumns:blockDragCheck?'minmax(0,1fr) 340px':split?'1fr 1fr':'1fr',zoom:scale}}><PdfPreview compact={split || blockDragCheck} paper={paper} jumpRequest={jumpRequest} onAddContext={addContext}/>{blockDragCheck ? <PdfBlockComposerPreview entry={paper ? {...entry,title:'Attention Is All You Need',pdfFileName:'attention-is-all-you-need.pdf'} : entry}
      externalItems={contexts} onRemoveExternal={id => setContexts(current => current.filter(item => item.id !== id))}
      segment={paper?.segments.find(segment => segment.page_idx === 2 && segment.segment_type === 'paragraph' && segment.text.length > 200) ?? paper?.segments[0] ?? interactionSegments[0]}
      onOpenSource={source => { if (source.provider !== 'sciverse') setJumpRequest(current => ({ kind: 'segment', segmentUid: source.segment_uid, pageIdx: source.page_idx, requestKey: (current?.requestKey ?? 0) + 1 })); }} /> : split?<PdfPreview compact paper={paper} viewId="right"/>:null}</div>
    <SearchDialog open={searchOpen} root={null} status="ready" onOpenChange={setSearchOpen} onOpenResult={noop}/>
  </main>;
}
const root=createRoot(document.getElementById('root')!);
root.render(<AppearanceProvider><TooltipProvider><ToastContext.Provider value={{dismiss:noop,notify:()=> 'preview'}}>{new URLSearchParams(location.search).has('math-array') ? <ArrayMathPreview/> : new URLSearchParams(location.search).has('image-resize') ? <NoteImageResizePreview/> : new URLSearchParams(location.search).has('fetch-pdf') ? <EntryPdfAcquisitionPreview/> : new URLSearchParams(location.search).has('toolbar') ? <ReaderToolbarPreview/> : <Showcase/>}</ToastContext.Provider></TooltipProvider></AppearanceProvider>);
if(import.meta.hot) import.meta.hot.dispose(()=>root.unmount());
