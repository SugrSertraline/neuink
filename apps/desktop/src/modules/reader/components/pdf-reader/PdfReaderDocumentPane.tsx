import { ExternalLink, FolderOpen, Loader2, RotateCcw } from 'lucide-react';
import type {
  MouseEvent as ReactMouseEvent,
  RefObject
} from 'react';
import { useEffect, useLayoutEffect, useState } from 'react';
import type { AssistantContextAddOptions } from '@/shared/types/assistant';

import type {
  Annotation,
  SegmentBlockNote,
  SourceSegment,
} from '@/shared/types/domain';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import type { TranslationStatus } from '@/shared/ipc/workspaceApi';
import type { PdfHoverPreviewFontSize, PdfHoverPreviewSize } from '@/shared/lib/readerPreferences';
import { Button } from '@/components/ui/button';

import type { LibraryEntry } from '../../../library/components/LibrarySidebar';
import type { SourceBacklink, SourceBacklinksBySegmentUid } from '../../types';
import { PdfSourcePage } from './PdfSourcePage';
import { ReaderMessage } from './ReaderMessage';
import type { PdfLoadState } from './usePdfDocument';
import type { RetryablePdfBytesLoadState } from './usePdfBytes';
import type { PageSegments } from './types';
import { useVisiblePdfPages } from './useVisiblePdfPages';
import { PDF_SPREAD_GAP } from './readerConstants';
import { centeredPdfScrollLeft } from './pdfViewportLayout';
import { usePdfBookNavigation } from './usePdfBookNavigation';
import { hasBookOpening } from '../book/bookOpeningSession';
import { PdfBookModel } from './PdfBookModel';
import { useAppearance } from '@/shared/components/AppearanceProvider';
import { PdfBookControls } from './PdfBookControls';
import { scrollToPage, scrollToPdfRect } from './readerUtils';
import { ReaderPinnedSegments } from '../pins/ReaderPinnedSegments';
import { PdfLayoutAnchor } from './PdfLayoutAnchor';
import { usePdfPan } from './usePdfPan';
import type { ApplyTextSelectionAnnotation } from './textSelectionAnnotation';
import type { PdfWheelZoomRequest } from './pdfWheelZoom';

export function PdfReaderDocumentPane({
  activeAnnotationId,
  autoTranslateTextSelection = false,
  entry,
  activeSearchPageIdx,
  flashSegmentUid,
  hoveredSegmentUid,
  annotationsBySegmentUid,
  notesBySegmentUid,
  pageWidth,
  bookMode = false,
  zoom = 1,
  resumePageIdx,
  leftInset = 0,
  hoverPreviewEnabled,
  hoverPreviewFontSize,
  hoverPreviewSize,
  hoverPreviewShowRegion,
  hoverPreviewShowOriginal,
  hoverPreviewShowNote,
  hoverPreviewShowAnnotation,
  inlineAnnotationHoverEnabled,
  hoverPreviewShowTranslation,
  sentenceHoverShowOriginal,
  sentenceHoverShowTranslation,
  rows,
  searchMatchCountsByPage,
  searchQuery,
  pdfAvailable,
  pdfBytesState,
  bindPdfScrollElement,
  pdfScrollRef,
  pdfState,
  showRegions,
  suppressRegions,
  sourceBacklinksBySegmentUid,
  sourceLinkHint,
  translationBySegmentUid,
  translationStatus,
  translationMode,
  translationVisible,
  workspaceRoot,
  onCtrlWheelZoom,
  onOpenPdf,
  onRevealPdf,
  onAddSourceLink,
  onCopyContent,
  onCopySourceLink,
  onInsertSegmentImage,
  onTranslateSegment,
  onOpenSegmentAnnotation,
  onOpenSegmentNote,
  onOpenSegmentWorkspace,
  onOpenSourceBacklink,
  onAddAssistantContext,
  onCloseSegmentOverlay,
  onCreateTextSelectionAnnotation,
  onTranslateTextSelection,
  onToggleSegment,
  sentenceLinkEnabled = false,
  sentenceHoverEnabled = false,
  onVisiblePageIndexesChange,
  altClickOpensNote = false
}: {
  activeAnnotationId?: string | null;
  autoTranslateTextSelection?: boolean;
  entry: LibraryEntry;
  activeSearchPageIdx?: number | null;
  flashSegmentUid: string | null;
  hoveredSegmentUid: string | null;
  annotationsBySegmentUid: Map<string, Annotation[]>;
  notesBySegmentUid: Map<string, SegmentBlockNote>;
  pageWidth: number;
  bookMode?: boolean;
  zoom?: number;
  resumePageIdx?: number | null;
  leftInset?: number;
  hoverPreviewEnabled: boolean;
  hoverPreviewFontSize: PdfHoverPreviewFontSize;
  hoverPreviewSize: PdfHoverPreviewSize;
  hoverPreviewShowRegion: boolean;
  hoverPreviewShowOriginal: boolean;
  hoverPreviewShowNote: boolean;
  hoverPreviewShowAnnotation: boolean;
  inlineAnnotationHoverEnabled: boolean;
  hoverPreviewShowTranslation: boolean;
  sentenceHoverShowOriginal: boolean;
  sentenceHoverShowTranslation: boolean;
  rows: PageSegments[][];
  searchMatchCountsByPage?: Map<number, number>;
  searchQuery?: string;
  pdfAvailable: boolean;
  pdfBytesState: RetryablePdfBytesLoadState;
  bindPdfScrollElement: (element: HTMLDivElement | null) => void;
  pdfScrollRef: RefObject<HTMLDivElement>;
  pdfState: PdfLoadState;
  showRegions: boolean;
  suppressRegions: boolean;
  sourceBacklinksBySegmentUid: SourceBacklinksBySegmentUid;
  sourceLinkHint?: string;
  translationBySegmentUid: Map<string, TranslatedSegment>;
  translationStatus: TranslationStatus | null;
  translationMode: 'replace' | 'hover';
  translationVisible: boolean;
  workspaceRoot: string | null;
  onCtrlWheelZoom: (request: PdfWheelZoomRequest) => void;
  onOpenPdf?: () => void;
  onRevealPdf?: () => void;
  onAddSourceLink?: (segment: SourceSegment) => void;
  onCopyContent?: (segment: SourceSegment) => void;
  onCopySourceLink?: (segment: SourceSegment) => void;
  onInsertSegmentImage?: (segment: SourceSegment) => void;
  onTranslateSegment?: (segment: SourceSegment) => void;
  onOpenSegmentAnnotation: (segment: SourceSegment, annotationId?: string) => void;
  onOpenSegmentNote: (segment: SourceSegment) => void;
  onOpenSegmentWorkspace?: (segment: SourceSegment) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onAddAssistantContext?: (segment: SourceSegment, options?: AssistantContextAddOptions) => void;
  onCloseSegmentOverlay: () => void;
  onCreateTextSelectionAnnotation: ApplyTextSelectionAnnotation;
  onTranslateTextSelection?: (input: { segment: SourceSegment; text: string }) => Promise<string>;
  onToggleSegment: (segment: SourceSegment, sentenceIndex?: number) => void;
  sentenceLinkEnabled?: boolean;
  sentenceHoverEnabled?: boolean;
  onVisiblePageIndexesChange?: (pageIndexes: number[]) => void;
  altClickOpensNote?: boolean;
}) {
  const { appearance } = useAppearance();
  const modelEnabled = bookMode && appearance === 'atelier';
  const [coverOpen, setCoverOpen] = useState(() => hasBookOpening(entry.id));
  useLayoutEffect(() => { setCoverOpen(hasBookOpening(entry.id)); }, [entry.id, modelEnabled]);
  const pageCount = rows.reduce((sum, row) => sum + row.length, 0);
  const pan = usePdfPan({ scrollRef: pdfScrollRef, context: `${entry.id}:${bookMode}:${pageWidth}`,
    enabled: pdfState.status === 'ready' && !suppressRegions });
  const continuous = useVisiblePdfPages({
    pageCount,
    enabled: !bookMode && pdfState.status === 'ready',
    scrollRef: pdfScrollRef
  });
  const book = usePdfBookNavigation({ enabled: bookMode, entryId: entry.id, rows,
    scrollRef: pdfScrollRef, document: pdfState.status === 'ready' ? pdfState.document : null,
    continuousPages: continuous.visiblePageIndexes, pageWidth, zoom, leftInset, onReveal: () => { setCoverOpen(true); return modelEnabled && !coverOpen; } });
  const spreadLength = rows[book.rowIndex]?.length ?? 1;
  const bookWidth = (book.pageWidth + 2) * spreadLength + (spreadLength - 1) * 2;
  const renderPageIndexes = bookMode ? book.render : continuous.renderPageIndexes;
  const visiblePageIndexes = bookMode ? book.visible : continuous.visiblePageIndexes;
  useEffect(() => {
    onVisiblePageIndexesChange?.([...visiblePageIndexes].sort((left, right) => left - right));
  }, [onVisiblePageIndexesChange, visiblePageIndexes]);
  useLayoutEffect(() => {
    const element = pdfScrollRef.current;
    if (!element || pdfState.status !== 'ready') return;
    // Center on opening only. PdfLayoutAnchor owns zoom, including manual pans.
    element.scrollLeft = centeredPdfScrollLeft(element.scrollWidth, element.clientWidth);
  }, [entry.id, bookMode, pdfState.status, pdfScrollRef]);
  useEffect(() => {
    const element = pdfScrollRef.current;
    if (!element || pdfState.status !== 'ready') return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      onCtrlWheelZoom({ deltaY: event.deltaY, deltaMode: event.deltaMode,
        timeStamp: event.timeStamp, viewportHeight: element.clientHeight });
    };
    // React's delegated wheel listener is passive; this viewport must own Ctrl+wheel.
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [onCtrlWheelZoom, pdfScrollRef, pdfState.status]);
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (hasActiveTextSelection()) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-pdf-page-index]')) {
      return;
    }

    onCloseSegmentOverlay();
  };

  return (
    <ReaderPinnedSegments entryId={entry.id} workspaceRoot={workspaceRoot}
      pdfDocument={pdfState.status === 'ready' ? pdfState.document : null} scrollRef={pdfScrollRef}
      onLocate={segment => scrollToPdfRect(segment.page_idx, segment.bbox, pdfScrollRef.current) || scrollToPage(segment.page_idx, pdfScrollRef.current)}>
    <PdfLayoutAnchor scrollRef={pdfScrollRef} documentKey={entry.id} pageWidth={book.pageWidth} zoom={zoom} bookMode={bookMode} leftInset={leftInset}>
    <div
      ref={bindPdfScrollElement}
      data-reader-scroll
      data-book-mode={bookMode || undefined}
      tabIndex={0}
      aria-label={bookMode ? '书页阅读区，PageUp 和 PageDown 翻页，按住空格拖动' : 'PDF 阅读区，按住空格拖动'}
      className="pdf-document-scroll h-full w-full min-h-0 min-w-0 max-w-full overflow-auto px-3 py-2"
      onPointerEnter={pan.onPointerEnter}
      onPointerLeave={pan.onPointerLeave}
      onPointerDownCapture={pan.onPointerDownCapture}
      onClickCapture={pan.onClickCapture}
      onKeyDown={event => {
        if (!bookMode || event.target !== event.currentTarget || hasActiveTextSelection() || event.ctrlKey || event.metaKey || event.altKey) return;
        const page = event.key === 'PageDown' ? book.nextPage : event.key === 'PageUp' ? book.previousPage : undefined;
        if (page !== undefined) { event.preventDefault(); scrollToPage(page, pdfScrollRef.current); }
      }}
      onClick={handleClick}
    >
      {pdfState.status === 'ready' ? (
        <div
          data-pdf-document-stage
          data-cover-closed={modelEnabled && !coverOpen || undefined}
          className={bookMode ? 'pdf-book-stage' : undefined}
          style={{
            marginLeft: leftInset,
              // Let the stage grow with the paper so both outer paddings remain
              // scrollable when crossing from fitted width into overflow.
              width: bookMode ? `max(calc(100% - ${leftInset}px), ${bookWidth + 88}px)` : 'max-content',
              minWidth: bookMode ? undefined : `calc(100% - ${leftInset}px)`
          }}
        >
          {modelEnabled && <PdfBookModel key={entry.id} id={entry.id} title={entry.title} topic={entry.tags[0] || '研究札记'}
            layoutKey={`${book.rowIndex}:${bookWidth}:${book.pageWidth}`} open={coverOpen} onOpen={() => { setCoverOpen(true); pdfScrollRef.current?.focus({ preventScroll: true }); }} />}
          {rows.map((row, rowIndex) => (
            <div
              key={row[0].pageIdx}
              data-book-spread={bookMode && rowIndex === book.rowIndex ? true : undefined}
              className="flex w-max min-w-full justify-center"
              style={{ gap: bookMode ? 2 : PDF_SPREAD_GAP, display: bookMode && rowIndex !== book.rowIndex ? 'none' : undefined }}
            >
              {row.map((page) => {
                const renderEnabled = renderPageIndexes.has(page.pageIdx);
                const visible = visiblePageIndexes.has(page.pageIdx);
                return (
                  <PdfSourcePage
                    activeAnnotationId={activeAnnotationId}
                    searchActive={activeSearchPageIdx === page.pageIdx}
                    searchMatchCount={searchMatchCountsByPage?.get(page.pageIdx) ?? 0}
                    searchQuery={searchQuery}
                    autoTranslateTextSelection={autoTranslateTextSelection}
                    annotationsBySegmentUid={annotationsBySegmentUid}
                    flashSegmentUid={flashSegmentUid}
                    hoveredSegmentUid={hoveredSegmentUid}
                    hoverPreviewEnabled={hoverPreviewEnabled}
                    hoverPreviewFontSize={hoverPreviewFontSize}
                    hoverPreviewSize={hoverPreviewSize}
                    hoverPreviewShowRegion={hoverPreviewShowRegion}
                    hoverPreviewShowOriginal={hoverPreviewShowOriginal}
                    hoverPreviewShowNote={hoverPreviewShowNote}
                    hoverPreviewShowAnnotation={hoverPreviewShowAnnotation}
                    inlineAnnotationHoverEnabled={inlineAnnotationHoverEnabled}
                    hoverPreviewShowTranslation={hoverPreviewShowTranslation}
                    sentenceHoverShowOriginal={sentenceHoverShowOriginal}
                    sentenceHoverShowTranslation={sentenceHoverShowTranslation}
                    key={page.pageIdx}
                    notesBySegmentUid={notesBySegmentUid}
                    page={page}
                    pageWidth={book.pageWidth}
                    pdfDocument={pdfState.document}
                    renderPriority={visible ? 'visible' : 'preload'}
                    renderEnabled={renderEnabled}
                    showRegions={showRegions}
                    sourceEntryId={entry.id}
                    sourceBacklinksBySegmentUid={sourceBacklinksBySegmentUid}
                    sourceLinkHint={sourceLinkHint}
                    // A page in the render window must remain interactive even
                    // while IntersectionObserver catches up after a smooth scroll.
                    suppressRegions={suppressRegions || pan.active || !renderEnabled}
                    translationBySegmentUid={translationBySegmentUid}
                    translationStatus={translationStatus}
                    translationMode={translationMode}
                    translationVisible={translationVisible}
                    workspaceRoot={workspaceRoot}
                    onAddSourceLink={onAddSourceLink}
                    onCopyContent={onCopyContent}
                    onCopySourceLink={onCopySourceLink}
                    onInsertSegmentImage={onInsertSegmentImage}
                    onTranslateSegment={onTranslateSegment}
                    onOpenSegmentAnnotation={onOpenSegmentAnnotation}
                    onOpenSegmentNote={onOpenSegmentNote}
                    onOpenSegmentWorkspace={onOpenSegmentWorkspace}
                    onOpenSourceBacklink={onOpenSourceBacklink}
                    onAddAssistantContext={onAddAssistantContext}
                    onCloseSegmentOverlay={onCloseSegmentOverlay}
                    onCreateTextSelectionAnnotation={onCreateTextSelectionAnnotation}
                    onTranslateTextSelection={onTranslateTextSelection}
                    onToggleSegment={onToggleSegment}
                    sentenceLinkEnabled={sentenceLinkEnabled}
                    sentenceHoverEnabled={sentenceHoverEnabled}
                    altClickOpensNote={altClickOpensNote}
                  />
                );
              })}
            </div>
          ))}
          {bookMode && (!modelEnabled || coverOpen) ? <PdfBookControls onClose={modelEnabled ? () => { book.cancelTurn(); setCoverOpen(false); } : undefined} previousPage={book.previousPage} nextPage={book.nextPage} scrollRef={pdfScrollRef}
            width={bookWidth}
            currentPage={(rows[book.rowIndex]?.[0]?.pageIdx ?? 0) + 1} pageCount={pageCount} resumePageIdx={resumePageIdx} /> : null}
        </div>
      ) : pdfBytesState.status === 'loading' || pdfState.status === 'loading' ? (
        <ReaderMessage
          icon={
            <Loader2 className="animate-spin" size={22} aria-hidden="true" />
          }
          title={pdfBytesState.status === 'loading' ? '正在读取 PDF' : '正在渲染 PDF'}
          description={
            pdfBytesState.status === 'loading'
              ? '正在从本地工作区读取 PDF 文件。'
              : '正在用 PDF.js 渲染本地 PDF 页面。'
          }
        />
      ) : pdfBytesState.status === 'error' ? (
        <ReaderMessage
          title="PDF 读取失败"
          description={pdfBytesState.error}
          tone="danger"
          action={
            <PdfRecoveryActions
              onOpenPdf={onOpenPdf}
              onRetry={pdfBytesState.retry}
              onRevealPdf={onRevealPdf}
            />
          }
        />
      ) : pdfState.status === 'error' ? (
        <ReaderMessage
          title="PDF 渲染失败"
          description={pdfState.error}
          tone="danger"
          action={
            <PdfRecoveryActions
              onOpenPdf={onOpenPdf}
              onRetry={pdfBytesState.retry}
              onRevealPdf={onRevealPdf}
            />
          }
        />
      ) : (
        <ReaderMessage
          title="PDF 路径不可用"
          description={pdfAvailable ? '本地 PDF 尚未完成读取。' : '当前条目没有可读取的 PDF 路径。'}
        />
      )}
    </div>
    </PdfLayoutAnchor>
    </ReaderPinnedSegments>
  );
}

export function PdfRecoveryActions({
  onOpenPdf,
  onRetry,
  onRevealPdf
}: {
  onOpenPdf?: () => void;
  onRetry: () => void;
  onRevealPdf?: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Button size="sm" type="button" variant="outline" onClick={onRetry}>
        <RotateCcw size={14} aria-hidden="true" />
        重新加载
      </Button>
      {onOpenPdf ? (
        <Button size="sm" type="button" variant="outline" onClick={onOpenPdf}>
          <ExternalLink size={14} aria-hidden="true" />
          系统打开
        </Button>
      ) : null}
      {onRevealPdf ? (
        <Button size="sm" type="button" variant="outline" onClick={onRevealPdf}>
          <FolderOpen size={14} aria-hidden="true" />
          显示文件
        </Button>
      ) : null}
    </div>
  );
}


function hasActiveTextSelection() {
  const selection = window.getSelection();

  return Boolean(
    selection && !selection.isCollapsed && selection.toString().trim()
  );
}
