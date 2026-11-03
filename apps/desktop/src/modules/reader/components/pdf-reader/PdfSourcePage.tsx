import { PdfReferenceLayer } from '../navigation/PdfReferenceLayer';
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { AssistantContextAddOptions } from '@/shared/types/assistant';
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { PointerPreview } from '@/components/ui/pointer-preview';
import { HOVER_TIMING, hoverInteractionBlocked, useHoverDismiss } from '@/components/ui/hover-interactions';
import { isMineruImagePath } from "@/shared/components/SourceSnapshotPreview";
import type { TranslatedSegment } from "@/shared/ipc/workspaceApi";
import type { TranslationStatus } from "@/shared/ipc/workspaceApi";
import type { PdfHoverPreviewFontSize, PdfHoverPreviewSize } from "@/shared/lib/readerPreferences";
import type {
  Annotation,
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
import { hasPdfTextSelection, pdfPageContentRect } from "./pdfCanvasDom";
import { usePdfTextSelection } from "./usePdfTextSelection";
import { notifyPdfInteraction } from "./pdfRenderQueue";
import { PdfTextSelectionToolbar } from "./PdfTextSelectionToolbar";
import type { ApplyTextSelectionAnnotation } from './textSelectionAnnotation';
import { SegmentActionMenu } from "./SegmentActionMenu";
import { PdfVisualDetail } from './PdfVisualDetail';
import { isVisualSegment, usePdfVisualDetail } from './usePdfVisualDetail';
import { SegmentRegion } from "./SegmentRegion";
import { logicalSegmentUid } from "./readerUtils";
import { requiresListItemChoice } from '@/shared/lib/listItemSegments';
import type { PageSegments } from "./types";
import { PdfAnnotationTabs } from './PdfAnnotationTabs';
import { PdfBlockDragPreview } from './PdfBlockDragPreview';
import { annotationPaperProps } from '@/modules/annotations/annotationPaper';
import { isPdfBlockDragControl, usePdfBlockDrag } from './usePdfBlockDrag';
import { layoutTranslatedParagraphs } from './translationLayout';
import { pdfOriginalContentWindows } from './PdfTranslationPageMask';
import { pdfSentenceGeometry, sentenceAtPoint, translatedSentenceGeometry, type PdfSentenceGeometry } from './pdfSentenceHover';
import { pdfSentencePreview, type PdfSentenceHover } from './pdfSentencePreview';
import { PaperTextPreview } from '../navigation/PaperReferences';
import { pdfPreviewTextMetrics } from './pdfPreviewTypography';

const EMPTY_ANNOTATIONS: Annotation[] = [];

function PdfSourcePageImpl({
  activeAnnotationId = null,
  autoTranslateTextSelection = false,
  flashSegmentUid,
  hoveredSegmentUid,
  hoverPreviewEnabled,
  hoverPreviewFontSize = 100,
  hoverPreviewSize = 100,
  hoverPreviewShowRegion,
  hoverPreviewShowOriginal,
  hoverPreviewShowNote,
  hoverPreviewShowAnnotation,
  inlineAnnotationHoverEnabled,
  hoverPreviewShowTranslation,
  sentenceHoverShowOriginal = false,
  sentenceHoverShowTranslation = false,
  annotationsBySegmentUid,
  notesBySegmentUid,
  page: sourcePage,
  pageWidth,
  pdfDocument,
  renderPriority,
  renderEnabled,
  searchActive = false,
  searchMatchCount = 0,
  searchQuery = '',
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
  sentenceLinkEnabled = false,
  sentenceHoverEnabled = false,
  altClickOpensNote = false,
}: {
  activeAnnotationId?: string | null;
  autoTranslateTextSelection?: boolean;
  flashSegmentUid: string | null;
  hoveredSegmentUid: string | null;
  hoverPreviewEnabled: boolean;
  hoverPreviewFontSize?: PdfHoverPreviewFontSize;
  hoverPreviewSize?: PdfHoverPreviewSize;
  hoverPreviewShowRegion: boolean;
  hoverPreviewShowOriginal: boolean;
  hoverPreviewShowNote: boolean;
  hoverPreviewShowAnnotation: boolean;
  inlineAnnotationHoverEnabled: boolean;
  hoverPreviewShowTranslation: boolean;
  sentenceHoverShowOriginal?: boolean;
  sentenceHoverShowTranslation?: boolean;
  annotationsBySegmentUid: Map<string, Annotation[]>;
  notesBySegmentUid: Map<string, SegmentBlockNote>;
  page: PageSegments;
  pageWidth: number;
  pdfDocument: PDFDocumentProxy;
  renderPriority: "preload" | "visible";
  renderEnabled: boolean;
  searchActive?: boolean;
  searchMatchCount?: number;
  searchQuery?: string;
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
  onOpenSegmentAnnotation: (segment: SourceSegment, annotationId?: string) => void;
  onOpenSegmentNote: (segment: SourceSegment) => void;
  onOpenSegmentWorkspace?: (segment: SourceSegment) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onAddAssistantContext?: (segment: SourceSegment, options?: AssistantContextAddOptions) => void;
  onCloseSegmentOverlay: () => void;
  onCreateTextSelectionAnnotation?: ApplyTextSelectionAnnotation;
  onTranslateTextSelection?: (input: { segment: SourceSegment; text: string }) => Promise<string>;
  onToggleSegment: (segment: SourceSegment, sentenceIndex?: number) => void;
  sentenceLinkEnabled?: boolean;
  sentenceHoverEnabled?: boolean;
  altClickOpensNote?: boolean;
}) {
  const hoverTextMetrics = pdfPreviewTextMetrics(hoverPreviewFontSize);
  const originalContentWindows = useMemo(
    () => translationVisible && translationMode === 'replace' && sourcePage.regions.length > 0
      ? pdfOriginalContentWindows(sourcePage)
      : null,
    [sourcePage, translationMode, translationVisible],
  );
  const translationLayout = useMemo(() => translationVisible && translationMode === 'replace'
    ? layoutTranslatedParagraphs(sourcePage, translationBySegmentUid) : new Map(),
    [sourcePage, translationBySegmentUid, translationMode, translationVisible]);
  const page = useMemo(() => translationLayout.size ? { ...sourcePage,
    regions: sourcePage.regions.map(region => ({ ...region, bbox: translationLayout.get(region.id)?.bbox ?? region.bbox }))
  } : sourcePage, [sourcePage, translationLayout]);
  // Zoom and split resizing pause segment interactions, but the translated page
  // is reading content and must remain visible throughout the size change.
  const renderSegmentLayer = !suppressRegions ||
    (renderEnabled && translationVisible && translationMode === 'replace');
  const pointerDownRef = useRef<{
    selectingText: boolean;
    startedOnTextLayer: boolean;
    x: number;
    y: number;
    segmentUid: string | null;
  } | null>(null);
  const [previewPosition, setPreviewPosition] = useState<{
    x: number;
    segmentRight: number;
    segmentTop: number;
    segmentBottom: number;
  } | null>(null);
  const [previewRegionId, setPreviewRegionId] = useState<string | null>(null);
  const [hoveredAnnotation, setHoveredAnnotation] = useState<{
    annotation: Annotation;
    anchor: { x: number; top: number; bottom: number };
  } | null>(null);
  const [localHoveredGroupUid, setLocalHoveredGroupUid] = useState<string | null>(null);
  const [hoveredSentence, setHoveredSentence] = useState<PdfSentenceHover | null>(null);
  const sentenceCacheRef = useRef<{ firstChild: ChildNode | null; pageWidth: number; regions: Map<string, PdfSentenceGeometry[] | null> }>({
    firstChild: null, pageWidth, regions: new Map(),
  });
  const translatedSentenceCacheRef = useRef(new WeakMap<HTMLElement, { key: string; geometry: PdfSentenceGeometry[] | null }>());
  const [actionMenu, setActionMenu] = useState<{
    position: { x: number; y: number };
    segment: SourceSegment;
    wholeListSegment?: SourceSegment;
  } | null>(null);
  const hitLayerRef = useRef<HTMLDivElement | null>(null);
  const visualDetail = usePdfVisualDetail(pdfDocument, sourceEntryId, workspaceRoot, suppressRegions);
  const sentencePreview = useMemo(() => {
    const host = hitLayerRef.current;
    if (!hoveredSentence || !host) return null;
    const region = page.regions.find(item => item.id === hoveredSentence.regionId);
    if (!region) return null;
    return pdfSentencePreview(hoveredSentence, region,
      (translationBySegmentUid.get(region.segment.uid) ??
        translationBySegmentUid.get(region.sourceSegment.uid))?.translated_text, pdfPageContentRect(host));
  }, [hoveredSentence, page.regions, translationBySegmentUid]);
  const paragraphFallback = sentenceHoverEnabled && sentenceHoverShowTranslation && hoverPreviewEnabled &&
    hoverPreviewShowTranslation && translationVisible && sentencePreview?.paragraphTranslation && !sentencePreview.translation
    ? sentencePreview : null;
  const blockDragEnabled = renderEnabled && renderPriority === 'visible' && !suppressRegions && Boolean(onAddAssistantContext);
  const blockDrag = usePdfBlockDrag(`${workspaceRoot}:${sourceEntryId}:${page.pageIdx}`, blockDragEnabled);
  const textSelection = usePdfTextSelection(hitLayerRef, page,
    Boolean(onCreateTextSelectionAnnotation || onTranslateTextSelection || onAddAssistantContext));
  const { pending: pendingTextSelection, close: closeTextSelectionToolbar, capture: captureTextSelection } = textSelection;
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
          active: annotation.annotation_id === activeAnnotationId,
          color: annotation.text_selection?.color ?? 'yellow',
          id: `${annotation.annotation_id}:${index}`,
          rect,
        })),
      ),
    [activeAnnotationId, pageTextSelectionAnnotations],
  );
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
  const previewRegionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!suppressRegions && hoverPreviewEnabled && inlineAnnotationHoverEnabled && sentenceHoverEnabled) {
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
    if (!hoverPreviewEnabled || suppressRegions) {
      hoveredGroupUidRef.current = null;
      previewRegionIdRef.current = null;
      setPreviewPosition(null);
      setPreviewRegionId(null);
      setLocalHoveredGroupUid(null);
    }
    if (!sentenceHoverEnabled || suppressRegions) setHoveredSentence(null);
    if (!inlineAnnotationHoverEnabled || suppressRegions) setHoveredAnnotation(null);
  }, [hoverPreviewEnabled, inlineAnnotationHoverEnabled, sentenceHoverEnabled, suppressRegions]);

  useEffect(() => {
    if (hoverAnimationFrameRef.current !== null) window.cancelAnimationFrame(hoverAnimationFrameRef.current);
    hoverAnimationFrameRef.current = null;
    pendingHoverSampleRef.current = null;
    setHoveredSentence(null);
  }, [translationMode, translationVisible]);

  const clearFloatingSegmentUi = () => {
    visualDetail.cancelClick();
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
    textSelection.clear();
    hoveredGroupUidRef.current = null;
    previewRegionIdRef.current = null;
    setPreviewPosition(null);
    setPreviewRegionId(null);
    setLocalHoveredGroupUid(null);
    setHoveredAnnotation(null);
    setHoveredSentence(null);

  };

  useEffect(() => {
    const closeSelectionUi = () => clearFloatingSegmentUi();
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
        previewRegionIdRef.current = null;
        setPreviewPosition(null);
        setPreviewRegionId(null);
        setLocalHoveredGroupUid(null);
        setHoveredAnnotation(null);
        setHoveredSentence(null);
      }
    }, HOVER_TIMING.close);
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
    elementRect = pdfPageContentRect(element),
  ) => {
    if (elementRect.width <= 0 || elementRect.height <= 0) {
      return null;
    }

    const x = ((clientX - elementRect.left) / elementRect.width) * 1000;
    const y = ((clientY - elementRect.top) / elementRect.height) * 1000;

    if (x < 0 || x > 1000 || y < 0 || y > 1000) {
      return null;
    }

    let best: PageSegments["regions"][number] | null = null;
    for (const region of page.regions) {
      const [x0, y0, x1, y1] = region.bbox;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) {
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
    previewRegionIdRef.current = null;
    setPreviewRegionId((current) => current === null ? current : null);
    setPreviewPosition((current) => current === null ? current : null);
    setHoveredAnnotation(null);
    setHoveredSentence(null);
  };

  const sentencesForRegion = (element: HTMLDivElement, region: PageSegments['regions'][number], pageRect: DOMRect) => {
    if (!sentenceLinkEnabled && !sentenceHoverEnabled) return null;
    if (translationVisible && translationMode === 'replace') {
      const layer = Array.from(element.querySelectorAll<HTMLElement>('[data-pdf-translation-region]'))
        .find(node => node.dataset.pdfTranslationRegion === region.id);
      const translated = translationBySegmentUid.get(region.segment.uid)?.translated_text ??
        translationBySegmentUid.get(region.sourceSegment.uid)?.translated_text;
      if (!layer || !translated) return null;
      const rect = layer.getBoundingClientRect();
      const fitted = layer.querySelector<HTMLElement>('.translation-replacement-preview');
      const key = JSON.stringify([region.bbox, region.sourceSegment.markdown ?? region.sourceSegment.text,
        translated, layer.textContent, fitted?.style.fontSize, rect.left - pageRect.left, rect.top - pageRect.top,
        rect.width, rect.height, pageRect.width, pageRect.height]);
      const cached = translatedSentenceCacheRef.current.get(layer);
      if (cached?.key === key) return cached.geometry;
      const geometry = translatedSentenceGeometry(layer, region, pageRect, translated);
      translatedSentenceCacheRef.current.set(layer, { key, geometry });
      return geometry;
    }
    const layer = element.querySelector<HTMLElement>('.pdf-text-layer');
    if (!layer?.firstChild) return null;
    const cache = sentenceCacheRef.current;
    if (cache.firstChild !== layer.firstChild || cache.pageWidth !== pageWidth) {
      cache.firstChild = layer.firstChild;
      cache.pageWidth = pageWidth;
      cache.regions.clear();
    }
    const cacheKey = `${region.id}:${region.bbox.join(',')}:${region.sourceSegment.markdown ?? region.sourceSegment.text}`;
    if (!cache.regions.has(cacheKey)) cache.regions.set(cacheKey, pdfSentenceGeometry(layer, region, pageRect));
    return cache.regions.get(cacheKey) ?? null;
  };

  useHoverDismiss(() => {
    cancelListPreviewClear();
    previewPointerInsideRef.current = false;
    if (hoverAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverAnimationFrameRef.current);
      hoverAnimationFrameRef.current = null;
    }
    pendingHoverSampleRef.current = null;
    clearHoveredRegion();
  }, hoverPreviewEnabled || sentenceHoverEnabled || inlineAnnotationHoverEnabled || Boolean(onAddAssistantContext));

  const updateHoveredSegmentAtPoint = (
    element: HTMLDivElement,
    clientX: number,
    clientY: number,
    buttons: number,
  ) => {
    if (suppressRegions || (!hoverPreviewEnabled && !sentenceHoverEnabled && !inlineAnnotationHoverEnabled && !onAddAssistantContext) || hoverInteractionBlocked()) {
      clearHoveredRegion();
      return;
    }

    // Pointer samples only arrive while the cursor is over the page hit layer,
    // so any stale "pointer inside the preview card" flag must be false. The
    // card's own pointerleave never fires when it unmounts or re-anchors away
    // from a stationary cursor, which otherwise left previews stuck forever.
    if (previewPointerInsideRef.current) {
      previewPointerInsideRef.current = false;
    }
    cancelListPreviewClear();

    const hitLayerRect = pdfPageContentRect(element);
    const annotationHit = inlineAnnotationHoverEnabled && buttons === 0
      ? findPdfAnnotationAtPoint(pageTextSelectionAnnotations, hitLayerRect, clientX, clientY)
      : null;
    if (annotationHit) {
      cancelListPreviewClear();
      hoveredGroupUidRef.current = null;
      previewRegionIdRef.current = null;
      setLocalHoveredGroupUid(null);
      setPreviewRegionId(null);
      setPreviewPosition(null);
      setHoveredSentence(null);
      const [, top, right, bottom] = annotationHit.rect;
      const anchor = {
        x: hitLayerRect.left + (right / 1000) * hitLayerRect.width,
        top: hitLayerRect.top + (top / 1000) * hitLayerRect.height,
        bottom: hitLayerRect.top + (bottom / 1000) * hitLayerRect.height,
      };
      setHoveredAnnotation((current) =>
        current?.annotation === annotationHit.annotation &&
        current.anchor.x === anchor.x && current.anchor.top === anchor.top &&
        current.anchor.bottom === anchor.bottom ? current : { annotation: annotationHit.annotation, anchor },
      );
      return;
    }
    setHoveredAnnotation((current) => current === null ? current : null);
    if (!hoverPreviewEnabled && !sentenceHoverEnabled && !onAddAssistantContext) {
      clearHoveredRegion();
      return;
    }
    const region = findRegionAtPoint(
      element,
      clientX,
      clientY,
      hitLayerRect,
    );

    const nextGroupUid = region?.hoverGroupUid ?? null;
    const sentenceRects = sentenceHoverEnabled && region && buttons === 0
      ? sentencesForRegion(element, region, hitLayerRect) : null;
    // Allow crossing from a failed sentence to its scrollable paragraph preview.
    if (buttons === 0 && !region && (previewRegionIdRef.current !== null || paragraphFallback)) {
      clearListPreviewAfterPointerExit();
      return;
    }
    if (sentenceHoverEnabled && region?.sourceSegment.segment_type === 'paragraph') {
      const sentence = sentenceAtPoint(sentenceRects ?? [], hitLayerRect, clientX, clientY);
      if (buttons === 0 && !sentence && sentenceRects?.length && paragraphFallback?.regionId === region.id) {
        clearListPreviewAfterPointerExit();
        return;
      }
      hoveredGroupUidRef.current = null;
      previewRegionIdRef.current = null;
      setLocalHoveredGroupUid(null);
      setPreviewRegionId(null);
      setPreviewPosition(null);
      const next = buttons === 0 && (sentence || !sentenceRects?.length) ? { regionId: region.id, sentence } : null;
      setHoveredSentence(current => current?.regionId === next?.regionId && current?.sentence === next?.sentence ? current : next);
      return;
    }
    setHoveredSentence(null);
    const nextRegionId = region?.id ?? null;
    const nextPreviewPosition = region && buttons === 0
      ? {
          x: hitLayerRect.left + (region.bbox[0] / 1000) * hitLayerRect.width,
          segmentRight: hitLayerRect.left + (region.bbox[2] / 1000) * hitLayerRect.width,
          segmentTop: hitLayerRect.top + (region.bbox[1] / 1000) * hitLayerRect.height,
          segmentBottom: hitLayerRect.top + (region.bbox[3] / 1000) * hitLayerRect.height,
        }
      : null;
    if (
      hoveredGroupUidRef.current === nextGroupUid &&
      previewRegionIdRef.current === nextRegionId
    ) {
      setPreviewPosition((current) =>
        current?.x === nextPreviewPosition?.x &&
        current?.segmentRight === nextPreviewPosition?.segmentRight &&
        current?.segmentTop === nextPreviewPosition?.segmentTop &&
        current?.segmentBottom === nextPreviewPosition?.segmentBottom
          ? current
          : nextPreviewPosition,
      );
      return;
    }

    hoveredGroupUidRef.current = nextGroupUid;
    previewRegionIdRef.current = nextRegionId;
    setLocalHoveredGroupUid(nextGroupUid);
    setPreviewRegionId(nextRegionId);
    setPreviewPosition(nextPreviewPosition);
  };

  const updateHoveredSegment = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('[data-hover-surface]')) return;
    blockDrag.trackModifier(event);
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
    visualDetail.cancelClick();
    notifyPdfInteraction();
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
      if (requiresListItemChoice(region.segment)) {
        setActionMenu({ segment: region.segment, position: { x: event.clientX, y: event.clientY } });
      } else onOpenSegmentNote(region.segment);
      return;
    }

    const startedOnTextLayer = isPdfTextLayerTarget(event.target);
    pointerDownRef.current = {
      selectingText: false,
      startedOnTextLayer,
      x: event.clientX,
      y: event.clientY,
      segmentUid: region?.segment.uid ?? null,
    };
    if (startedOnTextLayer) {
      textSelection.begin();
      clearHoveredRegion();
    } else {
      textSelection.clear();
    }
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressRegions) {
      return;
    }

    if (actionMenu) {
      clearFloatingSegmentUi();
    }
    const pointerDown = pointerDownRef.current;
    pointerDownRef.current = null;

    if (
      !pointerDown ||
      event.button !== 0 ||
      pointerDown.selectingText
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
    const segment = region?.segment ?? null;

    if (!segment || segment.uid !== pointerDown.segmentUid) {
      onCloseSegmentOverlay();
      return;
    }

    if (isVisualSegment(segment) && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      visualDetail.clickCandidate.current = segment.uid;
      if (event.detail < 2 && !hasPdfTextSelection(event.currentTarget.querySelector('.pdf-text-layer'))) {
        visualDetail.deferClick(() => onToggleSegment(segment));
      }
      return;
    }
    if (hasPdfTextSelection(event.currentTarget.querySelector('.pdf-text-layer'))) return;

    if (requiresListItemChoice(segment)) {
      setActionMenu({ segment, position: { x: event.clientX, y: event.clientY } });
    } else {
      const sentence = sentenceLinkEnabled && region ? sentenceAtPoint(sentencesForRegion(event.currentTarget, region, pdfPageContentRect(event.currentTarget)) ?? [],
        pdfPageContentRect(event.currentTarget), event.clientX, event.clientY) : null;
      if (sentence?.linkedSentenceIndex !== null && sentence?.linkedSentenceIndex !== undefined)
        onToggleSegment(segment, sentence.linkedSentenceIndex);
      else onToggleSegment(segment);
    }
  };

  const openVisualDetail = (segment: SourceSegment) => {
    clearFloatingSegmentUi();
    onCloseSegmentOverlay();
    const region = page.regions.find(item => item.segment.uid === segment.uid);
    const target: SourceSegment = { ...segment };
    if (region) {
      target.page_idx = region.pageIdx;
      target.bbox = [region.bbox[0], region.bbox[1], region.bbox[2], region.bbox[3]];
    }
    visualDetail.open(target);
  };
  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressRegions || blockDrag.dragItem || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const region = findRegionAtPoint(event.currentTarget, event.clientX, event.clientY);
    if (!region || !isVisualSegment(region.segment) || visualDetail.clickCandidate.current !== region.segment.uid) return;
    event.preventDefault();
    event.stopPropagation();
    if (hasPdfTextSelection(event.currentTarget.querySelector('.pdf-text-layer'))) window.getSelection()?.removeAllRanges();
    openVisualDetail(region.segment);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    visualDetail.cancelClick();
    event.preventDefault();
    if (blockDrag.dragItem) { blockDrag.cancel(); return; }

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
    const segment = region?.segment ?? null;

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
      wholeListSegment: region?.listItemIndex === undefined ? undefined : region.sourceSegment,
    });
  };

  const armedRegion = blockDrag.ctrlHeld && !pointerDownRef.current && blockDragEnabled
    ? page.regions.find(region => region.id === previewRegionId) : null;
  const blockDragItem = blockDrag.dragItem ?? (armedRegion && !requiresListItemChoice(armedRegion.segment)
    ? { entryId: sourceEntryId, workspaceRoot, segment: armedRegion.segment, bbox: armedRegion.bbox } : null);

  return (
    <section
      className="grid gap-1.5"
      data-pdf-page-index={page.pageIdx}
      id={`pdf-page-${page.pageIdx}`}
    >
      <div className="pdf-page-caption flex items-center justify-between gap-2 px-1">
        <Badge variant="outline">第 {page.pageIdx + 1} 页</Badge>
        <PdfAnnotationTabs page={page} annotations={annotationsBySegmentUid} onOpen={onOpenSegmentAnnotation} visible={renderPriority === 'visible'} />
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {blockDragEnabled ? <span className="mr-2">Ctrl + 拖动片段到聊天框</span> : null}
          {page.segments.length} regions
        </span>
      </div>

      <div
        ref={hitLayerRef}
        tabIndex={-1}
        className={`relative w-fit overflow-hidden rounded-md border bg-white shadow-sm ${blockDrag.dragItem
          ? 'cursor-grabbing [&_.pdf-text-layer]:!cursor-grabbing [&_.pdf-text-layer_span]:!cursor-grabbing'
          : armedRegion ? 'cursor-grab [&_.pdf-text-layer]:!cursor-grab [&_.pdf-text-layer_span]:!cursor-grab' : ''} ${
          searchActive
            ? 'ring-2 ring-primary/60'
            : searchMatchCount > 0
              ? 'ring-1 ring-warning/50'
              : ''
        }`}
        data-testid={`pdf-page-hit-layer-${page.pageIdx}`}
        data-pdf-page-surface="true"
        data-pdf-block-grab-ready={Boolean(armedRegion) || undefined}
        data-pdf-block-dragging={Boolean(blockDrag.preview) || undefined}
        onClickCapture={event => {
          if (blockDrag.consumeClick()) { event.preventDefault(); event.stopPropagation(); }
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onPointerDownCapture={event => {
          const region = event.ctrlKey && blockDragEnabled
            ? findRegionAtPoint(event.currentTarget, event.clientX, event.clientY) : null;
          if (region && event.button === 0 && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !isPdfBlockDragControl(event.target) && requiresListItemChoice(region.segment)) {
            event.preventDefault(); event.stopPropagation();
            clearFloatingSegmentUi();
            pointerDownRef.current = null;
            setActionMenu({ segment: region.segment, position: { x: event.clientX, y: event.clientY } });
            return;
          }
          if (blockDrag.start(event, region
            ? { entryId: sourceEntryId, workspaceRoot, segment: region.segment, bbox: region.bbox } : null)) {
            notifyPdfInteraction();
            clearFloatingSegmentUi();
          }
        }}
        onPointerDown={handlePointerDown}
        onFocusCapture={event => {
          // Keep keyboard focus and the existing block actions on the same region.
          if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-segment-uid')) return;
          const bounds = event.target.getBoundingClientRect();
          updateHoveredSegmentAtPoint(event.currentTarget, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, 0);
        }}
        onPointerEnter={updateHoveredSegment}
        onPointerLeave={() => {
          if (hoverAnimationFrameRef.current !== null) {
            window.cancelAnimationFrame(hoverAnimationFrameRef.current);
            hoverAnimationFrameRef.current = null;
            pendingHoverSampleRef.current = null;
          }
          pointerDownRef.current = null;
          if (previewRegionId !== null || paragraphFallback) {
            clearListPreviewAfterPointerExit();
            return;
          }
          clearHoveredRegion();
        }}
        onPointerMoveCapture={(event) => {
          if (blockDrag.ownsPointer(event.pointerId)) {
            blockDrag.pointerHandlers.onPointerMove(event);
            event.stopPropagation();
            return;
          }
          if ((event.target as Element).closest('[data-hover-surface]')) return;
          if ((event.target as Element).closest('[data-paper-reference]')) { clearHoveredRegion(); return; }
          blockDrag.trackModifier(event);
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
          if (blockDrag.ownsPointer(event.pointerId)) {
            blockDrag.pointerHandlers.onPointerUp(event);
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if ((event.target as Element).closest('[data-paper-reference], [data-hover-surface]')) return;
          if (event.button !== 0) {
            return;
          }
          textSelection.finish();
        }}
        onPointerCancel={event => {
          visualDetail.cancelClick();
          blockDrag.pointerHandlers.onPointerCancel(event);
          textSelection.clear();
        }}
        onLostPointerCapture={blockDrag.pointerHandlers.onLostPointerCapture}
      >
        <PdfReferenceLayer document={pdfDocument} pageIdx={page.pageIdx} enabled={renderEnabled && renderPriority === "visible" && !suppressRegions} />
        <PdfCanvasPage
          pageWidth={pageWidth}
          pdfDocument={pdfDocument}
          pageIdx={page.pageIdx}
          renderPriority={renderPriority}
          renderEnabled={renderEnabled}
          originalContentWindows={originalContentWindows}
          searchActive={searchActive}
          searchQuery={searchQuery}
        />

        <PdfTextSelectionHighlightLayer highlights={pageTextSelectionHighlights} />

        {hoveredSentence?.sentence && !suppressRegions && !pendingTextSelection ? (
          <div className="pointer-events-none absolute inset-0 z-[3]" aria-hidden="true" data-pdf-hover-sentence={hoveredSentence.sentence.index}>
            {hoveredSentence.sentence.rects.map(([left, top, right, bottom], index) => <span key={index}
              className="absolute rounded-sm bg-primary/15 ring-1 ring-primary/35"
              style={{ left: `${left / 10}%`, top: `${top / 10}%`, width: `${(right - left) / 10}%`, height: `${(bottom - top) / 10}%` }} />)}
          </div>
        ) : null}

        {sentencePreview && hoveredSentence?.sentence && !paragraphFallback && sentenceHoverEnabled && !suppressRegions && !pendingTextSelection &&
          (sentenceHoverShowOriginal || (sentenceHoverShowTranslation && sentencePreview.translation)) ? (
          <PointerPreview anchor={sentencePreview.anchor} width={380} className="pdf-segment-preview p-3 font-sans"
            role="region" aria-label="PDF 整句悬停预览">
            <div className="grid gap-2" style={{ fontSize: hoverTextMetrics.fontSize, lineHeight: `${hoverTextMetrics.lineHeight}px` }}>
              {sentenceHoverShowOriginal ? <PaperTextPreview allowScroll={false} markdown={sentencePreview.source}
                segmentType="paragraph" sourceEntryId={sourceEntryId} workspaceRoot={workspaceRoot} /> : null}
              {sentenceHoverShowTranslation && sentencePreview.translation ? <div className="text-muted-foreground">
                <PaperTextPreview allowScroll={false} markdown={sentencePreview.translation}
                  segmentType="paragraph" sourceEntryId={sourceEntryId} workspaceRoot={workspaceRoot} />
              </div> : null}
            </div>
          </PointerPreview>
        ) : null}

        {hoveredAnnotation && inlineAnnotationHoverEnabled && !suppressRegions && !blockDrag.dragItem ? (
          <PointerPreview
            anchor={hoveredAnnotation.anchor}
            width={Math.min(360, window.innerWidth - 24)}
            className="pdf-segment-preview p-3 font-sans"
            role="region"
            aria-label="选区批注悬停预览"
          >
            <div {...annotationPaperProps(hoveredAnnotation.annotation)} className="grid gap-2 text-sm leading-5">
              <div className="text-[11px] font-semibold text-muted-foreground">批注原文</div>
              <p className="whitespace-pre-wrap break-words text-foreground">{hoveredAnnotation.annotation.text_selection?.text}</p>
              {hoveredAnnotation.annotation.content.trim() ? (
                <>
                  <div className="border-t pt-2 text-[11px] font-semibold text-muted-foreground">批注</div>
                  <p className="whitespace-pre-wrap break-words text-foreground">{hoveredAnnotation.annotation.content}</p>
                </>
              ) : null}
            </div>
          </PointerPreview>
        ) : null}

        <PdfBlockDragPreview item={blockDragItem} preview={blockDrag.preview} />

        {renderSegmentLayer ? (
          <div className="pointer-events-none absolute inset-0 z-[2]">
            {page.regions.map((region) => {
              const fallback = paragraphFallback?.regionId === region.id && !pendingTextSelection ? paragraphFallback : null;
              return (
	                <SegmentRegion
	                  interactionSuppressed={suppressRegions}
	                  active={previewRegionId === region.id || Boolean(fallback)}
	                  flashed={flashSegmentUid === region.segment.uid || flashSegmentUid === region.sourceSegment.uid}
                  hasAnnotation={
                    (annotationsBySegmentUid.get(region.segment.uid)?.length ??
                      0) > 0
                  }
                  hasNote={notesBySegmentUid.has(region.segment.uid)}
	                  hovered={
	                    hoverPreviewEnabled &&
	                    (Boolean(fallback) || (
	                    !(sentenceHoverEnabled && region.sourceSegment.segment_type === 'paragraph') &&
	                    hoveredSentence?.regionId !== region.id &&
                    (localHoveredGroupUid === region.hoverGroupUid ||
                      hoveredSegmentUid === region.hoverGroupUid ||
                      hoveredSegmentUid === region.sourceSegment.uid)))
	                  }
	                  isContinuation={region.isContinuation}
	                  listItemIndex={region.listItemIndex}
	                  key={region.id}
	                  pageIdx={region.pageIdx}
	                  sourceBacklinkCount={
	                    sourceBacklinksForSegment(region.segment, sourceBacklinksBySegmentUid).length
	                  }
	                  sourceSegmentUid={region.sourceSegment.uid}
                  previewPosition={
                    hoverPreviewEnabled && !blockDrag.ctrlHeld && !blockDrag.dragItem
                      ? fallback?.paragraphPosition ?? (previewRegionId === region.id ? previewPosition : null)
                      : null
                  }
                  previewNotice={fallback ? '逐句译文暂不可用，已显示整段译文' : null}
                  previewFontSize={hoverPreviewFontSize}
                  previewSize={hoverPreviewSize}
                  previewShowRegion={hoverPreviewShowRegion}
                  previewShowOriginal={hoverPreviewShowOriginal}
                  previewShowNote={hoverPreviewShowNote}
                  previewShowAnnotation={hoverPreviewShowAnnotation}
                  previewShowTranslation={hoverPreviewShowTranslation}
                  relatedImagePath={
                    isCaptionRole(region.sourceSegment)
                      ? null
                      : region.sourceSegment.asset_path ??
                        relatedImagePathForSegment(
                          region.sourceSegment,
                          page.segments,
                        )
                  }
                  relatedCaptionText={relatedCaptionTextForSegment(
                    region.sourceSegment,
                    page.segments,
                  )}
                  regionBbox={region.bbox}
                  regionId={region.id}
                  segment={region.segment}
                  showRegions={showRegions}
                  sourceEntryId={sourceEntryId}
                  sourceLinkHint={sourceLinkHint}
                  translatedSegment={
                    translationBySegmentUid.get(region.segment.uid) ?? translationBySegmentUid.get(region.sourceSegment.uid) ??
                    null
                  }
                  previewNote={
                    notesBySegmentUid.get(logicalSegmentUid(region.segment))?.text ??
                    notesBySegmentUid.get(region.segment.uid)?.text ??
                    null
                  }
                  previewAnnotations={
                    annotationsBySegmentUid.get(logicalSegmentUid(region.segment)) ??
                    annotationsBySegmentUid.get(region.segment.uid) ??
                    EMPTY_ANNOTATIONS
                  }
                  translationStatus={translationStatus}
                  translationMode={translationMode}
                  replacementFontSize={pageWidth * 9 / 595}
                  translationVisible={translationVisible}
                  workspaceRoot={workspaceRoot}
                  onAddSourceLink={
                    onAddSourceLink
                      ? () => onAddSourceLink(region.segment)
                      : undefined
                  }
                  onPreviewPointerEnter={() => {
                    previewPointerInsideRef.current = true;
                    cancelListPreviewClear();
                    if (hoverAnimationFrameRef.current !== null) {
                      window.cancelAnimationFrame(hoverAnimationFrameRef.current);
                      hoverAnimationFrameRef.current = null;
                    }
                    pendingHoverSampleRef.current = null;
                  }}
                  onPreviewPointerLeave={() => {
                    previewPointerInsideRef.current = false;
                    clearListPreviewAfterPointerExit();
                  }}
                  onToggleSegment={() => {
                    if (requiresListItemChoice(region.segment)) {
                      const rect = document.getElementById(`segment-${region.segment.uid}`)?.getBoundingClientRect();
                      setActionMenu({ segment: region.segment, position: { x: rect?.left ?? 0, y: rect?.top ?? 0 } });
                    } else onToggleSegment(region.segment);
                  }}
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
	            wholeListSegment={actionMenu.wholeListSegment}
	            sourceBacklinks={sourceBacklinksForSegment(actionMenu.segment, sourceBacklinksBySegmentUid)}
	            onOpenSourceBacklink={onOpenSourceBacklink}
            onOpenVisualDetail={openVisualDetail}
	            onAddAssistantContext={
              onAddAssistantContext
                ? (segment) => {
                    clearFloatingSegmentUi();
                    onAddAssistantContext(segment);
                  }
                : undefined
            }
            onAddSourceLink={
              onAddSourceLink
                ? (segment) => {
                    clearFloatingSegmentUi();
                    onAddSourceLink(segment);
                  }
                : undefined
            }
            onCopySourceLink={
              onCopySourceLink
                ? (segment) => {
                    clearFloatingSegmentUi();
                    onCopySourceLink(segment);
                  }
                : undefined
            }
	            onCopyContent={
	              onCopyContent
	                ? (segment) => {
	                    clearFloatingSegmentUi();
	                    onCopyContent(segment);
	                  }
	                : undefined
	            }
            onInsertSegmentImage={
              onInsertSegmentImage
                ? (segment) => {
                    clearFloatingSegmentUi();
                    onInsertSegmentImage(segment);
                  }
                : undefined
            }
            onTranslateSegment={
              onTranslateSegment
                ? (segment) => {
                    clearFloatingSegmentUi();
                    onTranslateSegment(segment);
                  }
                : undefined
            }
            onOpenSegmentAnnotation={(segment) => {
              clearFloatingSegmentUi();
              onOpenSegmentAnnotation(segment);
            }}
            onOpenSegmentNote={(segment) => {
              clearFloatingSegmentUi();
              onOpenSegmentNote(segment);
            }}
            onOpenSegmentWorkspace={onOpenSegmentWorkspace}
            onClose={() => clearFloatingSegmentUi()}
          />
        ) : null}
        {onCreateTextSelectionAnnotation || onTranslateTextSelection || onAddAssistantContext ? (
        <PdfTextSelectionToolbar
          visible={renderPriority === 'visible'}
            autoTranslate={autoTranslateTextSelection}
            pending={pendingTextSelection}
            onApply={onCreateTextSelectionAnnotation}
            onClose={closeTextSelectionToolbar}
            onTranslate={onTranslateTextSelection}
            onAsk={onAddAssistantContext ? ({ segment, text }, intent) => {
              onAddAssistantContext(segment, { selectionText: text,
                draftQuestion: intent === 'explain' ? '请解释刚刚选中的这段内容，并结合原文说明。' : undefined });
              closeTextSelectionToolbar();
            } : undefined}
          />
        ) : null}
      </div>
      {visualDetail.segment ? <PdfVisualDetail key={visualDetail.segment.uid} segment={visualDetail.segment}
        pdfDocument={pdfDocument} workspaceRoot={workspaceRoot} entryId={sourceEntryId}
        onClose={visualDetail.close} onRestoreFocus={() => hitLayerRef.current?.focus({ preventScroll: true })} /> : null}
    </section>
  );
}

export const PdfSourcePage = memo(
  PdfSourcePageImpl,
  (previous, next) => {
    for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
      // Offscreen placeholders still own document geometry. Skipping pageWidth
      // leaves old wide rows in scrollWidth after a split and miscenters the PDF.
      // PdfCanvasPage gates expensive raster/text work with renderEnabled.
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

// MinerU v2 keeps captions as separate segments sharing the visual group of
// their figure/table; surface their text when hovering the visual itself.
function relatedCaptionTextForSegment(
  segment: SourceSegment,
  segments: SourceSegment[],
) {
  const groupId = segment.visual_group_id;
  if (!groupId) {
    return null;
  }

  return (
    segments
      .filter(
        (item) =>
          item.uid !== segment.uid &&
          item.visual_group_id === groupId &&
          (item.block_role === "caption" || item.block_role === "footnote"),
      )
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n\n") || null
  );
}

// Hovering a caption shows its text only; the image belongs to the visual
// region, not the caption strip.
function isCaptionRole(segment: SourceSegment) {
  return segment.block_role === "caption" || segment.block_role === "footnote";
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

export function findPdfAnnotationAtPoint(
  annotations: readonly Annotation[],
  pageRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
): { annotation: Annotation; rect: AnnotationTextSelection['rects'][number] } | null {
  if (pageRect.width <= 0 || pageRect.height <= 0) return null;
  const x = ((clientX - pageRect.left) / pageRect.width) * 1000;
  const y = ((clientY - pageRect.top) / pageRect.height) * 1000;
  let closest: { annotation: Annotation; rect: AnnotationTextSelection['rects'][number] } | null = null;
  for (const annotation of annotations) {
    for (const rect of annotation.text_selection?.rects ?? []) {
      if (x < rect[0] || x >= rect[2] || y < rect[1] || y >= rect[3]) continue;
      if (!closest || regionArea(rect) < regionArea(closest.rect)) {
        closest = { annotation, rect };
      }
    }
  }
  return closest;
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
