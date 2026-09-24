import { ExternalLink, FolderOpen, Loader2, RotateCcw } from 'lucide-react';
import type {
  MouseEvent as ReactMouseEvent,
  RefObject,
  WheelEvent as ReactWheelEvent
} from 'react';
import { useEffect } from 'react';
import type { AssistantContextAddOptions } from '@/shared/types/assistant';

import type {
  Annotation,
  AnnotationImportance,
  AnnotationTextSelection,
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
import { PdfBookControls } from './PdfBookControls';
import { scrollToPage } from './readerUtils';
import { PdfLayoutAnchor } from './PdfLayoutAnchor';

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
  hoverPreviewShowTranslation,
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
  hoverPreviewShowTranslation: boolean;
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
  onCtrlWheelZoom: (request: {
    clientX: number;
    clientY: number;
    container: HTMLDivElement;
    direction: 1 | -1;
  }) => void;
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
  onCreateTextSelectionAnnotation: (input: {
    content: string;
    importance: AnnotationImportance;
    segment: SourceSegment;
    selection: AnnotationTextSelection;
  }) => Promise<void> | void;
  onTranslateTextSelection?: (input: { segment: SourceSegment; text: string }) => Promise<string>;
  onToggleSegment: (segment: SourceSegment) => void;
  onVisiblePageIndexesChange?: (pageIndexes: number[]) => void;
  altClickOpensNote?: boolean;
}) {
  const pageCount = rows.reduce((sum, row) => sum + row.length, 0);
  const continuous = useVisiblePdfPages({
    pageCount,
    enabled: !bookMode && pdfState.status === 'ready',
    scrollRef: pdfScrollRef
  });
  const book = usePdfBookNavigation({ enabled: bookMode, entryId: entry.id, rows,
    scrollRef: pdfScrollRef, document: pdfState.status === 'ready' ? pdfState.document : null,
    continuousPages: continuous.visiblePageIndexes, pageWidth, zoom, leftInset });
  const spreadLength = rows[book.rowIndex]?.length ?? 1;
  const bookWidth = (book.pageWidth + 2) * spreadLength + (spreadLength - 1) * 2;
  const renderPageIndexes = bookMode ? book.render : continuous.renderPageIndexes;
  const visiblePageIndexes = bookMode ? book.visible : continuous.visiblePageIndexes;
  useEffect(() => {
    onVisiblePageIndexesChange?.([...visiblePageIndexes].sort((left, right) => left - right));
  }, [onVisiblePageIndexesChange, visiblePageIndexes]);
  useEffect(() => {
    const element = pdfScrollRef.current;
    if (!element) return undefined;

    const animationFrame = window.requestAnimationFrame(() => {
      const nextScrollLeft = centeredPdfScrollLeft(
        element.scrollWidth,
        element.clientWidth
      );
      if (element.scrollLeft !== nextScrollLeft) {
        element.scrollLeft = nextScrollLeft;
      }
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [pageWidth, pdfScrollRef]);
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey || event.deltaY === 0) {
      return;
    }

    event.preventDefault();
    onCtrlWheelZoom({
      clientX: event.clientX,
      clientY: event.clientY,
      container: event.currentTarget,
      direction: event.deltaY < 0 ? 1 : -1
    });
  };
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
    <PdfLayoutAnchor scrollRef={pdfScrollRef} pageWidth={pageWidth} zoom={zoom} bookMode={bookMode}>
    <div
      ref={bindPdfScrollElement}
      data-reader-scroll
      data-book-mode={bookMode || undefined}
      tabIndex={bookMode ? 0 : -1}
      aria-label={bookMode ? '书页阅读区，PageUp 和 PageDown 翻页' : undefined}
      className="pdf-document-scroll h-full w-full min-h-0 min-w-0 max-w-full overflow-auto px-3 py-2"
      onKeyDown={event => {
        if (!bookMode || event.target !== event.currentTarget || hasActiveTextSelection() || event.ctrlKey || event.metaKey || event.altKey) return;
        const page = event.key === 'PageDown' ? book.nextPage : event.key === 'PageUp' ? book.previousPage : undefined;
        if (page !== undefined) { event.preventDefault(); scrollToPage(page, pdfScrollRef.current); }
      }}
      onClick={handleClick}
      onWheel={handleWheel}
    >
      {pdfState.status === 'ready' ? (
        <div
          className={bookMode ? 'pdf-book-stage' : undefined}
          style={{
            marginLeft: leftInset,
            width: bookMode ? `max(calc(100% - ${leftInset}px), ${bookWidth + 88}px)` : `calc(100% - ${leftInset}px)`
          }}
        >
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
                    hoverPreviewShowTranslation={hoverPreviewShowTranslation}
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
                    suppressRegions={suppressRegions || !renderEnabled}
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
                    altClickOpensNote={altClickOpensNote}
                  />
                );
              })}
            </div>
          ))}
          {bookMode ? <PdfBookControls previousPage={book.previousPage} nextPage={book.nextPage} scrollRef={pdfScrollRef}
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
