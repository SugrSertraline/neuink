import type { PDFDocumentProxy } from "pdfjs-dist";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { isMineruImagePath } from "@/shared/components/SourceSnapshotPreview";
import type { TranslatedSegment } from "@/shared/ipc/workspaceApi";
import type { TranslationStatus } from "@/shared/ipc/workspaceApi";
import type {
  Annotation,
  AnnotationImportance,
  AnnotationTextSelection,
  SegmentBlockNote,
  SourceSegment,
} from "@/shared/types/domain";
import type { SourceBacklink, SourceBacklinksBySegmentUid } from "../../types";

import {
  PdfCanvasPage,
  PdfTextSelectionHighlightLayer,
  type PdfTextSelectionHighlight,
} from "./PdfCanvasPage";
import { hasPdfTextSelection } from "./pdfCanvasDom";
import {
  PdfTextSelectionToolbar,
  type PendingPdfTextSelection,
} from "./PdfTextSelectionToolbar";
import { SegmentActionMenu } from "./SegmentActionMenu";
import { SegmentRegion } from "./SegmentRegion";
import { logicalSegmentUid } from "./readerUtils";
import type { PageSegments } from "./types";

const PREVIEW_SUPPRESS_MS = 600;
const EMPTY_ANNOTATIONS: Annotation[] = [];

function PdfSourcePageImpl({
  autoTranslateTextSelection = false,
  flashSegmentUid,
  hoveredSegmentUid,
  hoverPreviewEnabled,
  hoverPreviewShowRegion,
  hoverPreviewShowOriginal,
  hoverPreviewShowNote,
  hoverPreviewShowAnnotation,
  hoverPreviewShowTranslation,
  annotationsBySegmentUid,
  notesBySegmentUid,
  page,
  pageWidth,
  pdfDocument,
  renderPriority,
  renderEnabled,
  showRegions,
  sourceBacklinksBySegmentUid,
  sourceEntryId,
  sourceLinkHint,
  suppressRegions,
  translationBySegmentUid,
  translationStatus,
  translationMode,
  translationVisible,
  workspaceRoot,
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
  altClickOpensNote = false,
}: {
  autoTranslateTextSelection?: boolean;
  flashSegmentUid: string | null;
  hoveredSegmentUid: string | null;
  hoverPreviewEnabled: boolean;
  hoverPreviewShowRegion: boolean;
  hoverPreviewShowOriginal: boolean;
  hoverPreviewShowNote: boolean;
  hoverPreviewShowAnnotation: boolean;
  hoverPreviewShowTranslation: boolean;
  annotationsBySegmentUid: Map<string, Annotation[]>;
  notesBySegmentUid: Map<string, SegmentBlockNote>;
  page: PageSegments;
  pageWidth: number;
  pdfDocument: PDFDocumentProxy;
  renderPriority: "preload" | "visible";
  renderEnabled: boolean;
  showRegions: boolean;
  sourceBacklinksBySegmentUid: SourceBacklinksBySegmentUid;
  sourceEntryId: string;
  sourceLinkHint?: string;
  suppressRegions: boolean;
  translationBySegmentUid: Map<string, TranslatedSegment>;
  translationStatus: TranslationStatus | null;
  translationMode: "replace" | "hover";
  translationVisible: boolean;
  workspaceRoot: string | null;
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
  onCreateTextSelectionAnnotation?: (input: {
    content: string;
    importance: AnnotationImportance;
    segment: SourceSegment;
    selection: AnnotationTextSelection;
  }) => Promise<void> | void;
  onTranslateTextSelection?: (input: { segment: SourceSegment; text: string }) => Promise<string>;
  onToggleSegment: (segment: SourceSegment) => void;
  altClickOpensNote?: boolean;
}) {
  const pointerDownRef = useRef<{
    selectingText: boolean;
    startedOnTextLayer: boolean;
    x: number;
    y: number;
    segmentUid: string | null;
  } | null>(null);
  const [previewPosition, setPreviewPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [previewRegionId, setPreviewRegionId] = useState<string | null>(null);
  const [localHoveredGroupUid, setLocalHoveredGroupUid] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<{
    position: { x: number; y: number };
    segment: SourceSegment;
  } | null>(null);
  const [pendingTextSelection, setPendingTextSelection] =
    useState<PendingPdfTextSelection | null>(null);
  const hitLayerRef = useRef<HTMLDivElement | null>(null);
  const textSelectionGestureRef = useRef(false);
  const textSelectionCaptureTimerRef = useRef<number | null>(null);
  const textSelectionCaptureSuppressedRef = useRef(false);
  const pageTextSelectionAnnotations = useMemo(
    () =>
      Array.from(annotationsBySegmentUid.values())
        .flat()
        .filter(
          (annotation) => annotation.text_selection?.page_idx === page.pageIdx,
        ),
    [annotationsBySegmentUid, page.pageIdx],
  );
  const pageTextSelectionHighlights = useMemo<PdfTextSelectionHighlight[]>(
    () =>
      pageTextSelectionAnnotations.flatMap((annotation) =>
        (annotation.text_selection?.rects ?? []).map((rect, index) => ({
          color: annotation.text_selection?.color ?? 'yellow',
          id: `${annotation.annotation_id}:${index}`,
          rect,
        })),
      ),
    [pageTextSelectionAnnotations],
  );
  const previewSuppressUntilRef = useRef(0);
  const previewPointerInsideRef = useRef(false);
  const previewClearTimerRef = useRef<number | null>(null);
  const hoverAnimationFrameRef = useRef<number | null>(null);
  const pendingHoverSampleRef = useRef<{
    buttons: number;
    clientX: number;
    clientY: number;
    element: HTMLDivElement;
  } | null>(null);
  const hoveredGroupUidRef = useRef<string | null>(null);
  const hoveredRegionRef = useRef<PageSegments["regions"][number] | null>(null);
  const previewRegionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!suppressRegions && hoverPreviewEnabled) {
      return;
    }

    pointerDownRef.current = null;
    if (hoverAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverAnimationFrameRef.current);
      hoverAnimationFrameRef.current = null;
      pendingHoverSampleRef.current = null;
    }
    if (suppressRegions) {
      setActionMenu(null);
    }
    hoveredGroupUidRef.current = null;
    hoveredRegionRef.current = null;
    previewRegionIdRef.current = null;
    setPreviewPosition(null);
    setPreviewRegionId(null);
    setLocalHoveredGroupUid(null);
  }, [hoverPreviewEnabled, suppressRegions]);

  const clearFloatingSegmentUi = (suppressPreview = false) => {
    if (previewClearTimerRef.current !== null) {
      window.clearTimeout(previewClearTimerRef.current);
      previewClearTimerRef.current = null;
    }
    previewPointerInsideRef.current = false;
    pointerDownRef.current = null;
    if (hoverAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverAnimationFrameRef.current);
      hoverAnimationFrameRef.current = null;
      pendingHoverSampleRef.current = null;
    }
    setActionMenu(null);
    setPendingTextSelection(null);
    hoveredGroupUidRef.current = null;
    hoveredRegionRef.current = null;
    previewRegionIdRef.current = null;
    setPreviewPosition(null);
    setPreviewRegionId(null);
    setLocalHoveredGroupUid(null);

    if (suppressPreview) {
      previewSuppressUntilRef.current = Date.now() + PREVIEW_SUPPRESS_MS;
    }
  };

  useEffect(() => {
    const closeSelectionUi = () => clearFloatingSegmentUi(true);
    window.addEventListener('neuink:reader-surface-change', closeSelectionUi);
    window.addEventListener('blur', closeSelectionUi);
    return () => {
      window.removeEventListener('neuink:reader-surface-change', closeSelectionUi);
      window.removeEventListener('blur', closeSelectionUi);
    };
  }, []);

  const clearListPreviewAfterPointerExit = () => {
    if (previewClearTimerRef.current !== null) {
      window.clearTimeout(previewClearTimerRef.current);
    }
    previewClearTimerRef.current = window.setTimeout(() => {
      previewClearTimerRef.current = null;
      if (!previewPointerInsideRef.current) {
        hoveredGroupUidRef.current = null;
        hoveredRegionRef.current = null;
        previewRegionIdRef.current = null;
        setPreviewPosition(null);
        setPreviewRegionId(null);
        setLocalHoveredGroupUid(null);
      }
    }, 180);
  };

  const cancelListPreviewClear = () => {
    if (previewClearTimerRef.current !== null) {
      window.clearTimeout(previewClearTimerRef.current);
      previewClearTimerRef.current = null;
    }
  };

  useEffect(
    () => () => {
      if (previewClearTimerRef.current !== null) {
        window.clearTimeout(previewClearTimerRef.current);
      }
      if (hoverAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverAnimationFrameRef.current);
      }
    },
    [],
  );

  const findRegionAtPoint = (
    element: HTMLDivElement,
    clientX: number,
    clientY: number,
  ) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const x = ((clientX - rect.left) / rect.width) * 1000;
    const y = ((clientY - rect.top) / rect.height) * 1000;

    if (x < 0 || x > 1000 || y < 0 || y > 1000) {
      return null;
    }

    const current = hoveredRegionRef.current;
    if (current) {
      const [x0, y0, x1, y1] = current.bbox;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
        return current;
      }
    }

    let best: PageSegments["regions"][number] | null = null;
    for (const region of page.regions) {
      const [x0, y0, x1, y1] = region.bbox;
      if (x < x0 || x > x1 || y < y0 || y > y1) {
        continue;
      }
      if (!best || compareHitRegions(region, best) < 0) {
        best = region;
      }
    }
    return best;
  };

  const clearHoveredRegion = () => {
    if (hoveredGroupUidRef.current !== null) {
      hoveredGroupUidRef.current = null;
      setLocalHoveredGroupUid(null);
    }
    hoveredRegionRef.current = null;
    previewRegionIdRef.current = null;
    setPreviewRegionId((current) => current === null ? current : null);
    setPreviewPosition((current) => current === null ? current : null);
  };

  const updateHoveredSegmentAtPoint = (
    element: HTMLDivElement,
    clientX: number,
    clientY: number,
    buttons: number,
  ) => {
    if (suppressRegions || !hoverPreviewEnabled) {
      clearHoveredRegion();
      return;
    }

    if (Date.now() < previewSuppressUntilRef.current) {
      clearHoveredRegion();
      return;
    }

    const region = findRegionAtPoint(
      element,
      clientX,
      clientY,
    );

    const nextGroupUid = region?.hoverGroupUid ?? null;
    const nextRegionId = region?.id ?? null;
    const hitLayerRect = element.getBoundingClientRect();
    const nextPreviewPosition = region && buttons === 0
      ? {
          x: hitLayerRect.left + (region.bbox[0] / 1000) * hitLayerRect.width,
          y: hitLayerRect.top + (region.bbox[1] / 1000) * hitLayerRect.height
        }
      : null;
    if (
      hoveredGroupUidRef.current === nextGroupUid &&
      previewRegionIdRef.current === nextRegionId
    ) {
      setPreviewPosition((current) =>
        current?.x === nextPreviewPosition?.x &&
        current?.y === nextPreviewPosition?.y
          ? current
          : nextPreviewPosition,
      );
      return;
    }

    hoveredGroupUidRef.current = nextGroupUid;
    hoveredRegionRef.current = region;
    previewRegionIdRef.current = nextRegionId;
    setLocalHoveredGroupUid(nextGroupUid);
    setPreviewRegionId(nextRegionId);
    setPreviewPosition(nextPreviewPosition);
  };

  const updateHoveredSegment = (event: ReactPointerEvent<HTMLDivElement>) => {
    updateHoveredSegmentAtPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
      event.buttons,
    );
  };

  const queueHoveredSegmentUpdate = (event: ReactPointerEvent<HTMLDivElement>) => {
    pendingHoverSampleRef.current = {
      buttons: event.buttons,
      clientX: event.clientX,
      clientY: event.clientY,
      element: event.currentTarget,
    };
    if (hoverAnimationFrameRef.current !== null) {
      return;
    }
    hoverAnimationFrameRef.current = window.requestAnimationFrame(() => {
      hoverAnimationFrameRef.current = null;
      const sample = pendingHoverSampleRef.current;
      pendingHoverSampleRef.current = null;
      if (sample) {
        updateHoveredSegmentAtPoint(
          sample.element,
          sample.clientX,
          sample.clientY,
          sample.buttons,
        );
      }
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      pointerDownRef.current = null;
      return;
    }

    if (suppressRegions) {
      pointerDownRef.current = null;
      return;
    }

    const region = findRegionAtPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
    );

    if (altClickOpensNote && event.altKey && region) {
      event.preventDefault();
      pointerDownRef.current = null;
      onOpenSegmentNote(region.sourceSegment);
      return;
    }

    const startedOnTextLayer = isPdfTextLayerTarget(event.target);
    pointerDownRef.current = {
      selectingText: false,
      startedOnTextLayer,
      x: event.clientX,
      y: event.clientY,
      segmentUid: region?.sourceSegment.uid ?? null,
    };
    if (startedOnTextLayer) {
      textSelectionGestureRef.current = true;
      setPendingTextSelection(null);
      clearHoveredRegion();
    } else {
      textSelectionGestureRef.current = false;
    }
  };

  const captureTextSelection = useCallback((element: HTMLDivElement) => {
    const textLayer = element.querySelector<HTMLElement>(".pdf-text-layer");
    if (!hasPdfTextSelection(textLayer)) {
      return;
    }

    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range) {
      return;
    }

    const pageRect = element.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) {
      return;
    }

    const rects = Array.from(range.getClientRects())
      .map((rect) => clipClientRectToPage(rect, pageRect))
      .filter((rect): rect is DOMRect => Boolean(rect))
      .map((rect) => [
        clampPdfCoordinate(((rect.left - pageRect.left) / pageRect.width) * 1000),
        clampPdfCoordinate(((rect.top - pageRect.top) / pageRect.height) * 1000),
        clampPdfCoordinate(((rect.right - pageRect.left) / pageRect.width) * 1000),
        clampPdfCoordinate(((rect.bottom - pageRect.top) / pageRect.height) * 1000),
      ] as [number, number, number, number])
      .filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0);
    const text = selection?.toString().trim() ?? "";
    if (!text || rects.length === 0) {
      return;
    }

    const segment = findSelectionAnchorSegment(page.regions, rects);
    if (!segment) {
      return;
    }

    const selectionRect = range.getBoundingClientRect();
    setPendingTextSelection({
      position: {
        x: selectionRect.left,
        y: selectionRect.bottom,
      },
      anchorRect: {
        bottom: selectionRect.bottom,
        left: selectionRect.left,
        right: selectionRect.right,
        top: selectionRect.top,
      },
      segment,
      selection: {
        page_idx: page.pageIdx,
        rects,
        text,
      },
    });
  }, [page.pageIdx, page.regions]);

  const scheduleTextSelectionCapture = useCallback(() => {
    if (textSelectionCaptureSuppressedRef.current) {
      return;
    }
    if (textSelectionCaptureTimerRef.current !== null) {
      window.clearTimeout(textSelectionCaptureTimerRef.current);
    }
    textSelectionCaptureTimerRef.current = window.setTimeout(() => {
      textSelectionCaptureTimerRef.current = null;
      const element = hitLayerRef.current;
      if (element) {
        captureTextSelection(element);
      }
    }, 24);
  }, [captureTextSelection]);

  const closeTextSelectionToolbar = useCallback(() => {
    textSelectionGestureRef.current = false;
    textSelectionCaptureSuppressedRef.current = true;
    if (textSelectionCaptureTimerRef.current !== null) {
      window.clearTimeout(textSelectionCaptureTimerRef.current);
      textSelectionCaptureTimerRef.current = null;
    }
    window.getSelection()?.removeAllRanges();
    setPendingTextSelection(null);
    window.setTimeout(() => {
      textSelectionCaptureSuppressedRef.current = false;
    }, 0);
  }, []);

  useEffect(() => {
    if (!onCreateTextSelectionAnnotation) {
      return;
    }

    const scheduleCapture = () => {
      if (!textSelectionGestureRef.current) {
        scheduleTextSelectionCapture();
      }
    };

    document.addEventListener("selectionchange", scheduleCapture);
    return () => {
      document.removeEventListener("selectionchange", scheduleCapture);
      if (textSelectionCaptureTimerRef.current !== null) {
        window.clearTimeout(textSelectionCaptureTimerRef.current);
        textSelectionCaptureTimerRef.current = null;
      }
    };
  }, [onCreateTextSelectionAnnotation, scheduleTextSelectionCapture]);

  useEffect(() => {
    const finishTextSelectionGesture = () => {
      if (!textSelectionGestureRef.current) {
        return;
      }
      textSelectionGestureRef.current = false;
      scheduleTextSelectionCapture();
    };
    window.addEventListener("pointerup", finishTextSelectionGesture);
    window.addEventListener("pointercancel", finishTextSelectionGesture);
    return () => {
      window.removeEventListener("pointerup", finishTextSelectionGesture);
      window.removeEventListener("pointercancel", finishTextSelectionGesture);
    };
  }, [scheduleTextSelectionCapture]);

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressRegions) {
      return;
    }

    if (actionMenu) {
      clearFloatingSegmentUi(true);
    }
    const pointerDown = pointerDownRef.current;
    pointerDownRef.current = null;

    if (
      !pointerDown ||
      event.button !== 0 ||
      pointerDown.selectingText ||
      hasPdfTextSelection(event.currentTarget.querySelector('.pdf-text-layer'))
    ) {
      return;
    }

    const moved = Math.hypot(
      event.clientX - pointerDown.x,
      event.clientY - pointerDown.y,
    );
    if (moved > 4) {
      return;
    }

    const region = findRegionAtPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
    );
    const segment = region?.sourceSegment ?? null;

    if (!segment || segment.uid !== pointerDown.segmentUid) {
      onCloseSegmentOverlay();
      return;
    }

    onToggleSegment(segment);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (suppressRegions) {
      return;
    }

    if (hasPdfTextSelection(event.currentTarget.querySelector(".pdf-text-layer"))) {
      captureTextSelection(event.currentTarget);
      return;
    }

    const region = findRegionAtPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
    );
    const segment = region?.sourceSegment ?? null;

    if (!segment) {
      return;
    }

    hoveredGroupUidRef.current = region?.hoverGroupUid ?? segment.uid;
    previewRegionIdRef.current = null;
    setLocalHoveredGroupUid(hoveredGroupUidRef.current);
    setPreviewRegionId(null);
    setPreviewPosition(null);
    setActionMenu({
      position: {
        x: event.clientX,
        y: event.clientY,
      },
      segment,
    });
  };

  return (
    <section
      className="grid gap-1.5"
      data-pdf-page-index={page.pageIdx}
      id={`pdf-page-${page.pageIdx}`}
    >
      <div className="flex items-center justify-between px-1">
        <Badge variant="outline">第 {page.pageIdx + 1} 页</Badge>
        <span className="text-xs text-muted-foreground">
          {page.segments.length} regions
        </span>
      </div>

      <div
        ref={hitLayerRef}
        className="relative w-fit overflow-hidden rounded-md border bg-white shadow-sm"
        data-testid={`pdf-page-hit-layer-${page.pageIdx}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerEnter={updateHoveredSegment}
        onPointerLeave={() => {
          if (hoverAnimationFrameRef.current !== null) {
            window.cancelAnimationFrame(hoverAnimationFrameRef.current);
            hoverAnimationFrameRef.current = null;
            pendingHoverSampleRef.current = null;
          }
          pointerDownRef.current = null;
          const isListPreview = page.regions.some(
            (region) =>
              region.id === previewRegionId &&
              region.sourceSegment.segment_type === "list",
          );
          if (isListPreview) {
            clearListPreviewAfterPointerExit();
            return;
          }
          clearHoveredRegion();
        }}
        onPointerMoveCapture={(event) => {
          const pointerDown = pointerDownRef.current;
          if (pointerDown?.startedOnTextLayer && (event.buttons & 1) === 1) {
            const moved = Math.hypot(
              event.clientX - pointerDown.x,
              event.clientY - pointerDown.y,
            );
            if (moved > 2) {
              pointerDown.selectingText = true;
              clearHoveredRegion();
              return;
            }
          }
          queueHoveredSegmentUpdate(event);
        }}
        onPointerUpCapture={(event) => {
          if (event.button !== 0) {
            return;
          }
          textSelectionGestureRef.current = false;
          scheduleTextSelectionCapture();
        }}
        onPointerCancel={() => {
          textSelectionGestureRef.current = false;
        }}
      >
        <PdfCanvasPage
          pageWidth={pageWidth}
          pdfDocument={pdfDocument}
          pageIdx={page.pageIdx}
          renderPriority={renderPriority}
          renderEnabled={renderEnabled}
        />

        <PdfTextSelectionHighlightLayer highlights={pageTextSelectionHighlights} />

        {!suppressRegions ? (
          <div className="pointer-events-none absolute inset-0 z-[2]">
            {page.regions.map((region) => {
              return (
	                <SegmentRegion
	                  active={previewRegionId === region.id}
	                  flashed={flashSegmentUid === region.sourceSegment.uid}
                  hasAnnotation={
                    (annotationsBySegmentUid.get(region.sourceSegment.uid)?.length ??
                      0) > 0
                  }
                  hasNote={notesBySegmentUid.has(region.sourceSegment.uid)}
	                  hovered={
	                    hoverPreviewEnabled &&
                    (localHoveredGroupUid === region.hoverGroupUid ||
                      hoveredSegmentUid === region.hoverGroupUid ||
                      hoveredSegmentUid === region.sourceSegment.uid)
	                  }
	                  isContinuation={region.isContinuation}
	                  listItemIndex={region.listItemIndex}
	                  key={region.id}
	                  pageIdx={region.pageIdx}
	                  sourceBacklinkCount={
	                    sourceBacklinksForSegment(region.sourceSegment, sourceBacklinksBySegmentUid).length
	                  }
	                  sourceSegmentUid={region.sourceSegment.uid}
                  previewPosition={
                    hoverPreviewEnabled && previewRegionId === region.id
                      ? previewPosition
                      : null
                  }
                  previewShowRegion={hoverPreviewShowRegion}
                  previewShowOriginal={hoverPreviewShowOriginal}
                  previewShowNote={hoverPreviewShowNote}
                  previewShowAnnotation={hoverPreviewShowAnnotation}
                  previewShowTranslation={hoverPreviewShowTranslation}
                  relatedImagePath={
                    region.sourceSegment.asset_path ??
                    relatedImagePathForSegment(
                      region.sourceSegment,
                      page.segments,
                    )
                  }
                  regionBbox={region.bbox}
                  regionId={region.id}
                  segment={region.segment}
                  showRegions={showRegions}
                  sourceEntryId={sourceEntryId}
                  sourceLinkHint={sourceLinkHint}
                  translatedSegment={
                    translationBySegmentUid.get(region.sourceSegment.uid) ??
                    null
                  }
                  previewNote={
                    notesBySegmentUid.get(logicalSegmentUid(region.sourceSegment))?.text ??
                    notesBySegmentUid.get(region.sourceSegment.uid)?.text ??
                    null
                  }
                  previewAnnotations={
                    annotationsBySegmentUid.get(logicalSegmentUid(region.sourceSegment)) ??
                    annotationsBySegmentUid.get(region.sourceSegment.uid) ??
                    EMPTY_ANNOTATIONS
                  }
                  translationStatus={translationStatus}
                  translationMode={translationMode}
                  translationVisible={translationVisible}
                  workspaceRoot={workspaceRoot}
                  onAddSourceLink={
                    onAddSourceLink
                      ? () => onAddSourceLink(region.sourceSegment)
                      : undefined
                  }
                  onPreviewPointerEnter={() => {
                    previewPointerInsideRef.current = true;
                    cancelListPreviewClear();
                  }}
                  onPreviewPointerLeave={() => {
                    previewPointerInsideRef.current = false;
                    clearListPreviewAfterPointerExit();
                  }}
                  onToggleSegment={() => onToggleSegment(region.sourceSegment)}
                />
              );
            })}
          </div>
        ) : null}
        {actionMenu ? (
	            <SegmentActionMenu
	            canAddSourceLink={Boolean(onAddSourceLink)}
	            canCopyContent={Boolean(onCopyContent)}
	            canCopySourceLink={Boolean(onCopySourceLink)}
	            canInsertSegmentImage={Boolean(onInsertSegmentImage)}
	            position={actionMenu.position}
	            segment={actionMenu.segment}
	            sourceBacklinks={sourceBacklinksForSegment(actionMenu.segment, sourceBacklinksBySegmentUid)}
	            onOpenSourceBacklink={onOpenSourceBacklink}
	            onAddAssistantContext={
              onAddAssistantContext
                ? (segment) => {
                    clearFloatingSegmentUi(true);
                    onAddAssistantContext(segment);
                  }
                : undefined
            }
            onAddSourceLink={
              onAddSourceLink
                ? (segment) => {
                    clearFloatingSegmentUi(true);
                    onAddSourceLink(segment);
                  }
                : undefined
            }
            onCopySourceLink={
              onCopySourceLink
                ? (segment) => {
                    clearFloatingSegmentUi(true);
                    onCopySourceLink(segment);
                  }
                : undefined
            }
	            onCopyContent={
	              onCopyContent
	                ? (segment) => {
	                    clearFloatingSegmentUi(true);
	                    onCopyContent(segment);
	                  }
	                : undefined
	            }
            onInsertSegmentImage={
              onInsertSegmentImage
                ? (segment) => {
                    clearFloatingSegmentUi(true);
                    onInsertSegmentImage(segment);
                  }
                : undefined
            }
            onTranslateSegment={
              onTranslateSegment
                ? (segment) => {
                    clearFloatingSegmentUi(true);
                    onTranslateSegment(segment);
                  }
                : undefined
            }
            onOpenSegmentAnnotation={(segment) => {
              clearFloatingSegmentUi(true);
              onOpenSegmentAnnotation(segment);
            }}
            onOpenSegmentNote={(segment) => {
              clearFloatingSegmentUi(true);
              onOpenSegmentNote(segment);
            }}
            onOpenSegmentWorkspace={onOpenSegmentWorkspace}
            onClose={() => clearFloatingSegmentUi(true)}
          />
        ) : null}
        {onCreateTextSelectionAnnotation ? (
          <PdfTextSelectionToolbar
            autoTranslate={autoTranslateTextSelection}
            pending={pendingTextSelection}
            onApply={onCreateTextSelectionAnnotation}
            onClose={closeTextSelectionToolbar}
            onTranslate={onTranslateTextSelection}
          />
        ) : null}
      </div>
    </section>
  );
}

export const PdfSourcePage = memo(
  PdfSourcePageImpl,
  (previous, next) => {
    for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
      if (key === "pageWidth" && !previous.renderEnabled && !next.renderEnabled) {
        continue;
      }
      const previousValue = previous[key];
      const nextValue = next[key];
      if (typeof previousValue === "function" || typeof nextValue === "function") {
        if (Boolean(previousValue) !== Boolean(nextValue)) {
          return false;
        }
        continue;
      }
      if (previousValue !== nextValue) {
        return false;
      }
    }
    return true;
  },
);

function relatedImagePathForSegment(
  segment: SourceSegment,
  segments: SourceSegment[],
) {
  if (segment.asset_path) {
    return segment.asset_path;
  }

  const ownText = segment.markdown ?? segment.text;
  if (isMineruImagePath(ownText)) {
    return ownText;
  }

  if (segment.segment_type !== "figure") {
    return null;
  }

  const segmentIndex = segments.findIndex((item) => item.uid === segment.uid);
  const candidates = segments
    .map((item, index) => ({
      distance: segmentIndex >= 0 ? Math.abs(index - segmentIndex) : index,
      item,
    }))
    .filter(
      ({ item }) =>
        item.segment_type === "figure" &&
        Boolean(
          item.asset_path || isMineruImagePath(item.markdown ?? item.text),
        ),
    )
    .sort((left, right) => left.distance - right.distance);

  return (
    candidates[0]?.item.asset_path ??
    candidates[0]?.item.markdown ??
    candidates[0]?.item.text ??
    null
  );
}

function sourceBacklinksForSegment(
  segment: SourceSegment,
  sourceBacklinksBySegmentUid: SourceBacklinksBySegmentUid,
) {
  return sourceBacklinksBySegmentUid[segment.uid] ??
    sourceBacklinksBySegmentUid[logicalSegmentUid(segment)] ?? [];
}

function isPdfTextLayerTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('.pdf-text-layer'));
}

function clampPdfCoordinate(value: number) {
  return Math.round(Math.min(1000, Math.max(0, value)) * 100) / 100;
}

function clipClientRectToPage(rect: DOMRect, pageRect: DOMRect) {
  const left = Math.max(rect.left, pageRect.left);
  const top = Math.max(rect.top, pageRect.top);
  const right = Math.min(rect.right, pageRect.right);
  const bottom = Math.min(rect.bottom, pageRect.bottom);
  if (right <= left || bottom <= top) {
    return null;
  }
  return { bottom, left, right, top } as DOMRect;
}

function findSelectionAnchorSegment(
  regions: PageSegments['regions'],
  rects: Array<[number, number, number, number]>,
) {
  let best: { area: number; segment: SourceSegment } | null = null;
  for (const region of regions) {
    const area = rects.reduce(
      (total, rect) => total + intersectionArea(rect, region.bbox),
      0,
    );
    if (!best || area > best.area) {
      best = { area, segment: region.sourceSegment };
    }
  }
  return best?.area ? best.segment : null;
}

function intersectionArea(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
) {
  const width = Math.max(0, Math.min(left[2], right[2]) - Math.max(left[0], right[0]));
  const height = Math.max(0, Math.min(left[3], right[3]) - Math.max(left[1], right[1]));
  return width * height;
}

function regionArea(bbox: readonly [number, number, number, number]) {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

function compareHitRegions(
  left: PageSegments["regions"][number],
  right: PageSegments["regions"][number],
) {
  return (
    hitRegionPriority(right) - hitRegionPriority(left) ||
    regionArea(left.bbox) - regionArea(right.bbox)
  );
}

function hitRegionPriority(region: PageSegments["regions"][number]) {
  const role = region.sourceSegment.block_role;
  if (role === "caption" || role === "footnote") {
    return 2;
  }
  if (region.sourceSegment.visual_group_id) {
    return 1;
  }
  return 0;
}
