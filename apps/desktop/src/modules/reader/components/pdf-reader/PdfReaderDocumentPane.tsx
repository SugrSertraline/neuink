import { Loader2 } from 'lucide-react';
import type {
  MouseEvent as ReactMouseEvent,
  RefObject,
  WheelEvent as ReactWheelEvent
} from 'react';

import type {
  Annotation,
  AnnotationImportance,
  AnnotationTextSelection,
  SegmentBlockNote,
  SourceSegment,
} from '@/shared/types/domain';
import type { TranslatedSegment } from '@/shared/ipc/workspaceApi';
import type { TranslationStatus } from '@/shared/ipc/workspaceApi';

import type { LibraryEntry } from '../../../library/components/LibrarySidebar';
import type { SourceBacklink, SourceBacklinksBySegmentUid } from '../../types';
import { PdfSourcePage } from './PdfSourcePage';
import { ReaderMessage } from './ReaderMessage';
import type { PdfLoadState } from './usePdfDocument';
import type { PdfBytesLoadState } from './usePdfBytes';
import type { PageSegments } from './types';
import { useVisiblePdfPages } from './useVisiblePdfPages';

export function PdfReaderDocumentPane({
  autoTranslateTextSelection = false,
  entry,
  flashSegmentUid,
  hoveredSegmentUid,
  annotationsBySegmentUid,
  notesBySegmentUid,
  pageWidth,
  leftInset = 0,
  hoverPreviewEnabled,
  hoverPreviewShowRegion,
  hoverPreviewShowOriginal,
  hoverPreviewShowNote,
  hoverPreviewShowAnnotation,
  hoverPreviewShowTranslation,
  pages,
  pdfAvailable,
  pdfBytesState,
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
  onToggleSegment
}: {
  autoTranslateTextSelection?: boolean;
  entry: LibraryEntry;
  flashSegmentUid: string | null;
  hoveredSegmentUid: string | null;
  annotationsBySegmentUid: Map<string, Annotation[]>;
  notesBySegmentUid: Map<string, SegmentBlockNote>;
  pageWidth: number;
  leftInset?: number;
  hoverPreviewEnabled: boolean;
  hoverPreviewShowRegion: boolean;
  hoverPreviewShowOriginal: boolean;
  hoverPreviewShowNote: boolean;
  hoverPreviewShowAnnotation: boolean;
  hoverPreviewShowTranslation: boolean;
  pages: PageSegments[];
  pdfAvailable: boolean;
  pdfBytesState: PdfBytesLoadState;
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
  onAddSourceLink?: (segment: SourceSegment) => void;
  onCopyContent?: (segment: SourceSegment) => void;
  onCopySourceLink?: (segment: SourceSegment) => void;
  onInsertSegmentImage?: (segment: SourceSegment) => void;
  onTranslateSegment?: (segment: SourceSegment) => void;
  onOpenSegmentAnnotation: (segment: SourceSegment) => void;
  onOpenSegmentNote: (segment: SourceSegment) => void;
  onOpenSegmentWorkspace?: (segment: SourceSegment) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onAddAssistantContext?: (segment: SourceSegment) => void;
  onCloseSegmentOverlay: () => void;
  onCreateTextSelectionAnnotation: (input: {
    content: string;
    importance: AnnotationImportance;
    segment: SourceSegment;
    selection: AnnotationTextSelection;
  }) => Promise<void> | void;
  onTranslateTextSelection?: (input: { segment: SourceSegment; text: string }) => Promise<string>;
  onToggleSegment: (segment: SourceSegment) => void;
}) {
  const { renderPageIndexes, visiblePageIndexes } = useVisiblePdfPages({
    pageCount: pages.length,
    scrollRef: pdfScrollRef
  });
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
    <div
      ref={pdfScrollRef}
      className="h-full min-h-0 min-w-0 overflow-auto px-3 py-2"
      onClick={handleClick}
      onWheel={handleWheel}
    >
      {pdfState.status === 'ready' ? (
        <div
          className="grid justify-items-center gap-3"
          style={{
            marginLeft: leftInset,
            minWidth: `calc(100% - ${leftInset}px)`
          }}
        >
          {pages.map((page) => {
            const renderEnabled = renderPageIndexes.has(page.pageIdx);
            const visible = visiblePageIndexes.has(page.pageIdx);
            return (
              <PdfSourcePage
                autoTranslateTextSelection={autoTranslateTextSelection}
                annotationsBySegmentUid={annotationsBySegmentUid}
                flashSegmentUid={flashSegmentUid}
                hoveredSegmentUid={hoveredSegmentUid}
                hoverPreviewEnabled={hoverPreviewEnabled}
                hoverPreviewShowRegion={hoverPreviewShowRegion}
                hoverPreviewShowOriginal={hoverPreviewShowOriginal}
                hoverPreviewShowNote={hoverPreviewShowNote}
                hoverPreviewShowAnnotation={hoverPreviewShowAnnotation}
                hoverPreviewShowTranslation={hoverPreviewShowTranslation}
                key={page.pageIdx}
                notesBySegmentUid={notesBySegmentUid}
                page={page}
                pageWidth={pageWidth}
                pdfDocument={pdfState.document}
                renderPriority={visible ? 'visible' : 'preload'}
                renderEnabled={renderEnabled}
                showRegions={showRegions}
                sourceEntryId={entry.id}
                sourceBacklinksBySegmentUid={sourceBacklinksBySegmentUid}
                sourceLinkHint={sourceLinkHint}
                suppressRegions={suppressRegions || !visible}
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
              />
            );
          })}
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
        />
      ) : pdfState.status === 'error' ? (
        <ReaderMessage
          title="PDF 渲染失败"
          description={pdfState.error}
          tone="danger"
        />
      ) : (
        <ReaderMessage
          title="PDF 路径不可用"
          description={pdfAvailable ? '本地 PDF 尚未完成读取。' : '当前条目没有可读取的 PDF 路径。'}
        />
      )}
    </div>
  );
}

function hasActiveTextSelection() {
  const selection = window.getSelection();

  return Boolean(
    selection && !selection.isCollapsed && selection.toString().trim()
  );
}
