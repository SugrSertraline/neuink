import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createPortal } from "react-dom";
import { Check, Copy, EyeOff, Link2, MessageCircle, StickyNote } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  resolveMineruAssetUrl,
  SourceSnapshotPreview,
} from "@/shared/components/SourceSnapshotPreview";
import { useToast } from "@/shared/hooks/useToast";
import type { TranslatedSegment } from "@/shared/ipc/workspaceApi";
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
  onHideSegment,
  onAddSourceLink,
  onCopyContent,
  onCopySourceLink,
  onOpenSourceBacklink,
  onAddAssistantContext,
  onTranslateSegment,
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
  onHideSegment: (segment: SourceSegment) => void;
  onAddSourceLink?: (segment: SourceSegment) => void;
  onCopyContent: (segment: SourceSegment) => void;
  onCopySourceLink: (segment: SourceSegment) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onAddAssistantContext?: (segment: SourceSegment) => void;
  onTranslateSegment?: (segment: SourceSegment) => void;
}) {
  const segmentGroups = useMemo(
    () => buildReflowSegmentGroups(segments),
    [segments],
  );
  const visibleSegmentGroups = useMemo(
    () =>
      segmentGroups.filter(
        (segmentGroup) => !hiddenSegmentUids.has(segmentGroup.body.uid),
      ),
    [hiddenSegmentUids, segmentGroups],
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
      ),
    getItemKey: (index) => visibleSegmentGroups[index]?.id ?? index,
    getScrollElement: () => reflowScrollRef.current,
    overscan: 6,
  });
  useEffect(() => {
    if (!scrollToSegmentUid) return;
    const groupIndex = groupIndexBySegmentUid.get(scrollToSegmentUid);
    if (groupIndex !== undefined) {
      rowVirtualizer.scrollToIndex(groupIndex, { align: 'center' });
    }
  }, [groupIndexBySegmentUid, rowVirtualizer, scrollRequestKey, scrollToSegmentUid]);
  const updatePreview = useCallback(
    (next: ReflowPreviewPointerState | null) => {
      if (!hoverPreviewEnabled || !next) {
        setPreview(null);
        return;
      }

      previewMoveRef.current?.(next.position);
      setPreview((current) => previewStateForPointer(current, next));
    },
    [hoverPreviewEnabled],
  );

  useEffect(() => {
    if (!hoverPreviewEnabled) {
      setPreview(null);
    }
  }, [hoverPreviewEnabled]);

  return (
    <div className="relative h-full min-h-0 min-w-0 overflow-hidden">
      <SegmentRailLayout
      rail={
        <SegmentRail
          activeSegmentUid={activeSegmentUid}
          annotationsBySegmentUid={annotationsBySegmentUid}
          flashSegmentUid={flashSegmentUid}
          notesBySegmentUid={notesBySegmentUid}
          pageCount={pageCount}
          pages={pages}
          selectedSegmentUid={activeSegmentUid}
          onJumpToSegment={(segmentUid) => {
            const groupIndex = groupIndexBySegmentUid.get(segmentUid);
            if (groupIndex === undefined) return;
            rowVirtualizer.scrollToIndex(groupIndex, { align: "start" });
          }}
        />
      }
    >
      <div
        ref={reflowScrollRef}
        className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-muted/20 px-6 py-6"
        style={{ paddingLeft: PDF_RAIL_WIDTH + 24 }}
      >
        <article
          data-reflow-total-groups={visibleSegmentGroups.length}
          className="relative mx-auto w-full min-w-0 max-w-[860px]"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
        {visibleSegmentGroups.length > 0 ? (
          rowVirtualizer.getVirtualItems().map((virtualRow) => {
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
                    (segment) => segment.uid === flashSegmentUid,
                  )}
                  hoverPreviewEnabled={hoverPreviewEnabled}
                  notesBySegmentUid={notesBySegmentUid}
                  pdfDocument={pdfDocument}
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
            鐟滅増鎸告晶?Entry 閺夆晜蓱閻ュ懘寮垫径濠傝闂佹彃绉电敮鎾绘儍閸曨啩鎺楀几閹邦剚鍋ラ柕?
          </div>
        )}
        </article>
      </div>
      </SegmentRailLayout>

      {preview ? (
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
  );
}
