import { PaperReferencesProvider } from '../navigation/PaperReferences';
import type { AssistantContextAddOptions } from '@/shared/types/assistant';
import { PdfTextSelectionToolbar } from '../pdf-reader/PdfTextSelectionToolbar';
import { useReflowTextSelection } from './useReflowTextSelection';
import { useReflowReadingNavigation } from '../navigation/useReflowReadingNavigation';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createPortal } from "react-dom";
import { Check, Copy, EyeOff, Link2, MessageCircle, StickyNote } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Badge } from "@/components/ui/badge";
import { hoverInteractionBlocked, useHoverDismiss } from '@/components/ui/hover-interactions';
import { ParagraphTranslationProvider } from './ParagraphTranslationContext';
import { ReflowSegmentPreferencesProvider } from './ReflowSegmentPreferences';
import { cn } from "@/lib/utils";
import {
  resolveMineruAssetUrl,
  SourceSnapshotPreview,
} from "@/shared/components/SourceSnapshotPreview";
import { useToast } from "@/shared/hooks/useToast";
import type { TranslatedSegment } from "@/shared/ipc/workspaceApi";
import type { ReflowComponentPreferences } from "@/shared/lib/readerPreferences";
import type { Annotation, SegmentBlockNote, SourceSegment } from "@/shared/types/domain";

import {
  logicalSegmentUid,
  groupSegmentsByPage,
  inferPageCount,
  segmentDisplayLabel,
} from "../pdf-reader/readerUtils";
import { SegmentActionMenu } from "../pdf-reader/SegmentActionMenu";
import { SegmentRail } from "../pdf-reader/SegmentRail";
import { SegmentRailLayout } from "../pdf-reader/SegmentRailLayout";
import { PDF_RAIL_WIDTH } from "../pdf-reader/readerConstants";
import { useReadingActivityTracker } from "../pdf-reader/useReadingActivityTracker";
import type { SourceBacklinksBySegmentUid } from "../../types";
import type { SourceBacklink } from "../../types";
import {
  buildReflowSegmentGroups,
  type ReflowSegmentGroup,
} from "./buildReflowBlocks";
import {
  readCachedPdfSegmentSnapshot,
  warmCachedPdfSegmentSnapshot,
} from "./pdfSourceSnapshot";
import {
  buildReflowGroupIndex,
  estimateReflowGroupSize,
} from "./reflowVirtualization";

export type ReflowTranslationMode = "source" | "translation" | "bilingual";

import { ReflowSegmentGroupView } from './ReflowSegmentGroupView';
import {
  ReflowSourcePreview,
  previewStateForPointer,
  type ReflowPreviewPointerState,
  type ReflowPreviewPosition
} from './ReflowSourcePreview';
import {
  isReflowGroupVisible,
  ReflowComponentPreferencesProvider,
  reflowGroupEstimateScale
} from './ReflowComponentPreferencesContext';

export function ReflowReader({
  activeSegmentUid,
  annotationsBySegmentUid,
  entryId,
  flashSegmentUid,
  hoverPreviewEnabled,
  hoverPreviewShowOriginal,
  hoverPreviewShowTranslation,
  hoverPreviewShowNote,
  hoverPreviewShowAnnotation,
  notesBySegmentUid,
  pdfDocument,
  reflowBackgroundColor,
  reflowComponents,
  reflowFontSize,
  reflowTranslationMode,
  hiddenSegmentUids,
  segments,
  sourceLinkCountBySegmentUid,
  sourceBacklinksBySegmentUid,
  scrollToSegmentUid,
  scrollRequestKey,
  translationBySegmentUid,
  workspaceRoot,
  onActivateSegment,
  altClickOpensNote = false,
  onOpenSegmentAnnotation,
  onOpenSegmentNote,
  onRequirePdfDocument,
  pdfPreviewError,
  onRetryPdfPreview,
  onHideSegment,
  onAddSourceLink,
  onCopyContent,
  onCopySourceLink,
  onOpenSourceBacklink,
  onAddAssistantContext,
  onTranslateSegment,
  onTranslateTextSelection,
}: {
  activeSegmentUid: string | null;
  annotationsBySegmentUid: Map<string, Annotation[]>;
  entryId: string;
  flashSegmentUid: string | null;
  hoverPreviewEnabled: boolean;
  hoverPreviewShowOriginal: boolean;
  hoverPreviewShowTranslation: boolean;
  hoverPreviewShowNote: boolean;
  hoverPreviewShowAnnotation: boolean;
  notesBySegmentUid: Map<string, SegmentBlockNote>;
  pdfDocument: PDFDocumentProxy | null;
  reflowBackgroundColor: string;
  reflowComponents: ReflowComponentPreferences;
  reflowFontSize: number;
  reflowTranslationMode: ReflowTranslationMode;
  hiddenSegmentUids: Set<string>;
  segments: SourceSegment[];
  sourceLinkCountBySegmentUid: Map<string, number>;
  sourceBacklinksBySegmentUid: SourceBacklinksBySegmentUid;
  scrollToSegmentUid?: string | null;
  scrollRequestKey?: number;
  translationBySegmentUid: Map<string, TranslatedSegment>;
  workspaceRoot: string | null;
  onActivateSegment: (
    segment: SourceSegment,
    options?: { jumpToPdf?: boolean },
  ) => void;
  altClickOpensNote?: boolean;
  onOpenSegmentAnnotation: (segment: SourceSegment) => void;
  onOpenSegmentNote: (segment: SourceSegment) => void;
  onRequirePdfDocument: () => void;
  pdfPreviewError?: string | null;
  onRetryPdfPreview?: () => void;
  onHideSegment: (segment: SourceSegment) => void;
  onAddSourceLink?: (segment: SourceSegment) => void;
  onCopyContent: (segment: SourceSegment) => void;
  onCopySourceLink: (segment: SourceSegment) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onAddAssistantContext?: (segment: SourceSegment, options?: AssistantContextAddOptions) => void;
  onTranslateSegment?: (segment: SourceSegment) => void;
  onTranslateTextSelection?: (input: { segment: SourceSegment; text: string }) => Promise<string>;
}) {
  const segmentGroups = useMemo(
    () => buildReflowSegmentGroups(segments),
    [segments],
  );
  const visibleSegmentGroups = useMemo(
    () =>
      segmentGroups.filter(
        (segmentGroup) =>
          !hiddenSegmentUids.has(segmentGroup.body.uid) &&
          isReflowGroupVisible(segmentGroup, reflowComponents),
      ),
    [hiddenSegmentUids, reflowComponents, segmentGroups],
  );
  const visibleSegments = useMemo(
    () => visibleSegmentGroups.flatMap((segmentGroup) => segmentGroup.segments),
    [visibleSegmentGroups],
  );
  const pageCount = useMemo(() => inferPageCount(segments), [segments]);
  const pages = useMemo(
    () => groupSegmentsByPage(visibleSegments, pageCount),
    [pageCount, visibleSegments],
  );
  const groupIndexBySegmentUid = useMemo(
    () => buildReflowGroupIndex(visibleSegmentGroups),
    [visibleSegmentGroups],
  );
  const previewMoveRef = useRef<
    ((position: ReflowPreviewPosition) => void) | null
  >(null);
  const reflowScrollRef = useRef<HTMLDivElement | null>(null);
  const resumedReadingStateKeyRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<{
    initialPosition: ReflowPreviewPosition;
    relatedImagePath?: string | null;
    segment: SourceSegment;
  } | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: visibleSegmentGroups.length,
    estimateSize: (index) =>
      estimateReflowGroupSize(
        visibleSegmentGroups[index],
        reflowTranslationMode,
      ) * (reflowFontSize / 16) * reflowGroupEstimateScale(
        visibleSegmentGroups[index],
        reflowComponents
      ),
    getItemKey: (index) => visibleSegmentGroups[index]?.id ?? index,
    getScrollElement: () => reflowScrollRef.current,
    overscan: 6,
  });
  useEffect(() => {
    rowVirtualizer.measure();
  }, [reflowComponents, reflowFontSize, rowVirtualizer]);
  const navigation = useReflowReadingNavigation(reflowScrollRef, visibleSegmentGroups, rowVirtualizer, groupIndexBySegmentUid);
  const textSelection = useReflowTextSelection(reflowScrollRef, visibleSegments);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const scrollTop = reflowScrollRef.current?.scrollTop ?? 0;
  const viewportBottom = scrollTop + (reflowScrollRef.current?.clientHeight ?? 0);
  const visiblePageIndexes = useMemo(
    () => [...new Set(
      virtualRows
        .filter((row) => row.end >= scrollTop && row.start <= viewportBottom)
        .flatMap((row) => visibleSegmentGroups[row.index]?.segments.map((segment) => segment.page_idx) ?? [])
    )].sort((left, right) => left - right),
    [scrollTop, viewportBottom, virtualRows, visibleSegmentGroups]
  );
  const savedReadingState = useReadingActivityTracker({
    enabled: visibleSegmentGroups.length > 0,
    entryId,
    mode: "reflow",
    pageCount,
    scrollRef: reflowScrollRef,
    visiblePageIndexes,
    workspaceRoot,
  });
  useEffect(() => {
    if (navigation.hasRetainedPosition || scrollToSegmentUid || !savedReadingState || savedReadingState.current_page_idx === null) {
      return;
    }
    const resumeKey = `${entryId}:${savedReadingState.document_hash ?? "none"}`;
    if (resumedReadingStateKeyRef.current === resumeKey) {
      return;
    }
    const groupIndex = visibleSegmentGroups.findIndex((group) =>
      group.segments.some((segment) => segment.page_idx >= savedReadingState.current_page_idx!)
    );
    if (groupIndex >= 0) {
      resumedReadingStateKeyRef.current = resumeKey;
      rowVirtualizer.scrollToIndex(groupIndex, { align: "start" });
    }
  }, [entryId, navigation.hasRetainedPosition, scrollToSegmentUid, rowVirtualizer, savedReadingState, visibleSegmentGroups]);
  useEffect(() => {
    if (!scrollToSegmentUid) return;
    const jumpKey = `${entryId}:${scrollToSegmentUid}:${scrollRequestKey}`;
    if (navigation.isJumpHandled?.(jumpKey)) return;
    const groupIndex = groupIndexBySegmentUid.get(scrollToSegmentUid);
    if (groupIndex !== undefined) {
      navigation.markJumpHandled?.(jumpKey);
      if (navigation.navigate) navigation.navigate({ pageIdx: visibleSegmentGroups[groupIndex].body.page_idx, segmentUid: scrollToSegmentUid });
      else rowVirtualizer.scrollToIndex(groupIndex, { align: 'center' });
    }
  }, [groupIndexBySegmentUid, rowVirtualizer, scrollRequestKey, scrollToSegmentUid]);
  const updatePreview = useCallback(
    (next: ReflowPreviewPointerState | null) => {
      if (!hoverPreviewEnabled || !next || hoverInteractionBlocked()) {
        setPreview(null);
        return;
      }

      previewMoveRef.current?.(next.position);
      setPreview((current) => previewStateForPointer(current, next));
    },
    [hoverPreviewEnabled],
  );

  useHoverDismiss(() => setPreview(null), hoverPreviewEnabled);

  useEffect(() => {
    if (!hoverPreviewEnabled) {
      setPreview(null);
    }
  }, [hoverPreviewEnabled]);

  return (
    <PaperReferencesProvider segments={segments} entryId={entryId} workspaceRoot={workspaceRoot} pdfDocument={pdfDocument} onRequirePdfDocument={onRequirePdfDocument} pdfPreviewError={pdfPreviewError} onRetryPdfPreview={onRetryPdfPreview}>
    <ReflowComponentPreferencesProvider value={reflowComponents}>
    <ParagraphTranslationProvider root={workspaceRoot} entryId={entryId}>
    <ReflowSegmentPreferencesProvider root={workspaceRoot} entryId={entryId}>
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
      <SegmentRailLayout
      rail={
        <SegmentRail
          activeSegmentUid={activeSegmentUid}
          annotationsBySegmentUid={annotationsBySegmentUid}
          flashSegmentUid={flashSegmentUid}
          notesBySegmentUid={notesBySegmentUid}
          pages={pages}
          selectedSegmentUid={activeSegmentUid}
          onJumpToSegment={(segmentUid) => {
            const groupIndex = groupIndexBySegmentUid.get(segmentUid);
            if (groupIndex === undefined) return;
            navigation.remember?.();
            rowVirtualizer.scrollToIndex(groupIndex, { align: "start" });
          }}
        />
      }
    >
      <div
        ref={reflowScrollRef}
        onPointerUp={() => { textSelection.capture(); setPreview(null); }}
        onKeyUp={event => { if (event.shiftKey) { textSelection.capture(); setPreview(null); } }}
        tabIndex={-1}
        className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-6 py-6"
        data-reflow-background-color={reflowBackgroundColor}
        style={reflowSurfaceStyle(reflowBackgroundColor)}
      >
        <article
          data-reflow-total-groups={visibleSegmentGroups.length}
          data-reflow-font-size={reflowFontSize}
          className="reflow-reading-surface relative mx-auto w-full min-w-0 max-w-[860px]"
          style={{ fontSize: reflowFontSize, height: rowVirtualizer.getTotalSize() }}
        >
        {visibleSegmentGroups.length > 0 ? (
          virtualRows.map((virtualRow) => {
            const segmentGroup = visibleSegmentGroups[virtualRow.index];
            return (
              <div
                data-index={virtualRow.index}
                data-reflow-virtual-item
                key={segmentGroup.id}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <ReflowSegmentGroupView
                  active={segmentGroup.segments.some(
                    (segment) => segment.uid === activeSegmentUid,
                  )}
                  annotationsBySegmentUid={annotationsBySegmentUid}
                  entryId={entryId}
                  flashed={segmentGroup.segments.some(
                    (segment) => segment.uid === flashSegmentUid || segment.uid === navigation.flashUid,
                  )}
                  hoverPreviewEnabled={hoverPreviewEnabled}
                  notesBySegmentUid={notesBySegmentUid}
                  pdfDocument={pdfDocument}
                  pdfPreviewError={pdfPreviewError}
                  onRetryPdfPreview={onRetryPdfPreview}
                  reflowTranslationMode={reflowTranslationMode}
                  segmentGroup={segmentGroup}
                  translationBySegmentUid={translationBySegmentUid}
                  sourceLinkCountBySegmentUid={sourceLinkCountBySegmentUid}
                  sourceBacklinksBySegmentUid={sourceBacklinksBySegmentUid}
                  workspaceRoot={workspaceRoot}
                  onActivateSegment={onActivateSegment}
                  altClickOpensNote={altClickOpensNote}
                  onOpenSegmentAnnotation={onOpenSegmentAnnotation}
                  onOpenSegmentNote={onOpenSegmentNote}
                  onPreviewChange={updatePreview}
                  onRequirePdfDocument={onRequirePdfDocument}
                  onHideSegment={onHideSegment}
                  onAddSourceLink={onAddSourceLink}
                  onCopyContent={onCopyContent}
                  onCopySourceLink={onCopySourceLink}
                  onOpenSourceBacklink={onOpenSourceBacklink}
                  onAddAssistantContext={onAddAssistantContext}
                  onTranslateSegment={onTranslateSegment}
                />
              </div>
            );
          })
        ) : (
          <div className="rounded-md border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            此 Entry 尚未解析出可显示的正文。
          </div>
        )}
        </article>
      </div>
      </SegmentRailLayout>

      <PdfTextSelectionToolbar pending={textSelection.pending} onClose={textSelection.close} onTranslate={onTranslateTextSelection}
        onAsk={onAddAssistantContext ? ({ segment, text }, intent) => {
          onAddAssistantContext(segment, { selectionText: text,
            draftQuestion: intent === 'explain' ? '请解释刚刚选中的这段内容，并结合原文说明。' : undefined });
          textSelection.close();
        } : undefined} />

      {preview && !textSelection.pending ? (
        <ReflowSourcePreview
          annotations={
            annotationsBySegmentUid.get(logicalSegmentUid(preview.segment)) ??
            annotationsBySegmentUid.get(preview.segment.uid) ??
            []
          }
          initialPosition={preview.initialPosition}
          noteText={
            notesBySegmentUid.get(logicalSegmentUid(preview.segment))?.text ??
            notesBySegmentUid.get(preview.segment.uid)?.text ??
            null
          }
          relatedImagePath={preview.relatedImagePath}
          segment={preview.segment}
          showAnnotation={hoverPreviewShowAnnotation}
          showNote={hoverPreviewShowNote}
          showOriginal={hoverPreviewShowOriginal}
          showTranslation={hoverPreviewShowTranslation}
          translatedText={
            translationBySegmentUid.get(logicalSegmentUid(preview.segment))?.translated_text ??
            translationBySegmentUid.get(preview.segment.uid)?.translated_text ??
            null
          }
          pdfDocument={pdfDocument}
          sourceEntryId={entryId}
          workspaceRoot={workspaceRoot}
          onMoveReady={(move) => {
            previewMoveRef.current = move;
          }}
        />
      ) : null}
    </div>
    </ReflowSegmentPreferencesProvider>
    </ParagraphTranslationProvider>
    </ReflowComponentPreferencesProvider>
    </PaperReferencesProvider>
  );
}

function reflowSurfaceStyle(backgroundColor: string): CSSProperties {
  const dark = isDarkHexColor(backgroundColor);
  const foreground = dark ? '#f8fafc' : '#172033';

  return {
    '--background': backgroundColor,
    '--border': `color-mix(in srgb, ${backgroundColor} 80%, ${foreground})`,
    '--card': backgroundColor,
    '--card-foreground': foreground,
    '--foreground': foreground,
    '--muted': `color-mix(in srgb, ${backgroundColor} 90%, ${foreground})`,
    '--muted-foreground': dark ? '#cbd5e1' : '#697386',
    backgroundColor,
    color: foreground,
    paddingLeft: PDF_RAIL_WIDTH + 24
  } as CSSProperties;
}

function isDarkHexColor(color: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return false;

  const [red, green, blue] = match.slice(1).map((value) => Number.parseInt(value, 16));
  return (red * 299 + green * 587 + blue * 114) / 1000 < 140;
}
