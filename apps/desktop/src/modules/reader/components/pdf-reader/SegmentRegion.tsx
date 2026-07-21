import { layout, prepare } from '@chenglou/pretext';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { Link2, MessageCircle, StickyNote } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import type { TranslatedSegment, TranslationStatus } from '@/shared/ipc/workspaceApi';
import type { Annotation, SourceSegment } from '@/shared/types/domain';

import { segmentColor, segmentDisplayLabel } from './readerUtils';
import { ListHoverPreview, listItemTextAtIndex } from './ListHoverPreview';
import { parseListItemRegions, type ListItemRegion } from './listItemRegions';

const PREVIEW_MARGIN = 12;
const PREVIEW_FONT_FAMILY =
  '"Geist Variable", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif';
const PREVIEW_COLUMN_GAP = 18;
const REPLACEMENT_MIN_WIDTH = 24;
const REPLACEMENT_MIN_HEIGHT = 8;

function SegmentRegionImpl({
  flashed,
  hasAnnotation,
  hasNote,
  active,
  hovered,
  isContinuation,
  listItemIndex,
  pageIdx,
  previewPosition,
  previewShowRegion,
  previewShowOriginal,
  previewShowNote,
  previewShowAnnotation,
  previewShowTranslation,
  previewNote,
  previewAnnotations,
  relatedImagePath,
  regionBbox,
  regionId,
  segment,
  showRegions,
  sourceBacklinkCount,
  sourceEntryId,
  sourceSegmentUid,
  sourceLinkHint,
  translatedSegment,
  translationStatus,
  translationMode,
  translationVisible,
  workspaceRoot,
  onAddSourceLink,
  onPreviewPointerEnter,
  onPreviewPointerLeave,
  onToggleSegment
}: {
  flashed: boolean;
  hasAnnotation: boolean;
  hasNote: boolean;
  active: boolean;
  hovered: boolean;
  isContinuation: boolean;
  listItemIndex?: number;
  pageIdx: number;
  previewPosition: { x: number; y: number } | null;
  previewShowRegion: boolean;
  previewShowOriginal: boolean;
  previewShowNote: boolean;
  previewShowAnnotation: boolean;
  previewShowTranslation: boolean;
  previewNote: string | null;
  previewAnnotations: Annotation[];
  relatedImagePath?: string | null;
  regionBbox: readonly [number, number, number, number];
  regionId: string;
  segment: SourceSegment;
  showRegions: boolean;
  sourceBacklinkCount: number;
  sourceEntryId: string;
  sourceSegmentUid?: string;
  sourceLinkHint?: string;
  translatedSegment: TranslatedSegment | null;
  translationStatus: TranslationStatus | null;
  translationMode: 'replace' | 'hover';
  translationVisible: boolean;
  workspaceRoot: string | null;
  onAddSourceLink?: (segment: SourceSegment) => void;
  onPreviewPointerEnter?: () => void;
  onPreviewPointerLeave?: () => void;
  onToggleSegment: (segment: SourceSegment) => void;
}) {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const [regionSize, setRegionSize] = useState({ height: 0, width: 0 });
  const [hoveredListItemBbox, setHoveredListItemBbox] = useState<ListItemRegion['bbox'] | null>(null);
  const [x0, y0, x1, y1] = regionBbox;
  const color = segmentColor(segment.segment_type);
  const displayLabel = segmentDisplayLabel(segment);
  const hasIndicators = hasNote || hasAnnotation || sourceBacklinkCount > 0;
  const visible = showRegions || (hovered && previewShowRegion);
  const indicatorsExpanded = hovered || active;
  const interactive = showRegions || flashed || hasIndicators || hovered || active;
  const translatedText = useMemo(() => {
    const fullTranslation = translatedSegment?.translated_text?.trim() || null;
    if (
      !fullTranslation ||
      segment.segment_type !== 'list' ||
      listItemIndex === undefined
    ) {
      return fullTranslation;
    }
    return listItemTextAtIndex(fullTranslation, listItemIndex);
  }, [listItemIndex, segment.segment_type, translatedSegment?.translated_text]);
  const showTranslationMask =
    translationVisible && translationMode === 'replace' && shouldMaskInTranslationMode(segment);
  const showTranslationReplacement = showTranslationMask && Boolean(translatedText);
  const replacementStyle = useMemo(
    () =>
      buildReplacementTextStyle({
        height: regionSize.height,
        segmentType: segment.segment_type,
        text: translatedText ?? '',
        width: regionSize.width
      }),
    [regionSize.height, regionSize.width, segment.segment_type, translatedText]
  );
  const listItemRegions = useMemo(
    () => parseListItemRegions(segment.mineru_metadata?.list_item_regions),
    [segment.mineru_metadata?.list_item_regions],
  );

  useEffect(() => {
    const node = regionRef.current;
    if (!showTranslationMask || !node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setRegionSize((current) => {
        const next = {
          height: Math.round(rect.height),
          width: Math.round(rect.width)
        };
        return current.height === next.height && current.width === next.width ? current : next;
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [showTranslationMask]);

  useEffect(() => {
    if (!active) {
      setHoveredListItemBbox(null);
    }
  }, [active]);

  const selectWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleSegment(segment);
    }
  };
  const selectWithPointer = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    onToggleSegment(segment);
  };

  return (
    <div
      ref={regionRef}
      className={cn(
        'absolute rounded-[2px] text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        'pointer-events-none',
        flashed && 'segment-navigation-highlight z-[3]'
      )}
      data-segment-uid={segment.uid}
      data-source-segment-uid={sourceSegmentUid ?? segment.uid}
      id={isContinuation ? `segment-${regionId}` : `segment-${segment.uid}`}
      role={interactive ? 'button' : undefined}
      style={{
        left: `${x0 / 10}%`,
        top: `${y0 / 10}%`,
        width: `${Math.max(1, x1 - x0) / 10}%`,
        height: `${Math.max(1, y1 - y0) / 10}%`,
        border: flashed
          ? '3px solid var(--primary)'
          : showTranslationMask
            ? '1.5px solid transparent'
            : `1.5px solid ${visible ? color : 'transparent'}`,
        backgroundColor: showTranslationMask
          ? 'transparent'
          : active
            ? `${color}24`
            : hovered
              ? `${color}10`
              : showRegions
                ? `${color}20`
            : 'transparent'
      }}
      title={`${displayLabel} · 第 ${
        pageIdx + 1
      }${isContinuation ? ' · 续段推断区域' : ''}`}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? selectWithPointer : undefined}
      onKeyDown={selectWithKeyboard}
    >
      {showTranslationMask ? (
        <div
          className={cn(
            'absolute -inset-[2px] z-[1] flex overflow-hidden bg-white text-foreground transition-opacity duration-100',
            active && 'opacity-0'
          )}
        >
          {showTranslationReplacement ? (
            <div
              className="translation-replacement-preview min-w-0 flex-1 overflow-hidden px-px py-0"
              style={replacementStyle}
            >
              <SourceSnapshotPreview
                allowScroll={false}
                flush
                markdown={translatedText ?? ''}
                segmentType={segment.segment_type}
                sourceEntryId={sourceEntryId}
                workspaceRoot={workspaceRoot}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {hoveredListItemBbox ? (
        <span
          className="pointer-events-none absolute z-[3] rounded-[2px] border-2 border-primary bg-primary/15 shadow-[0_0_0_2px_rgba(255,255,255,0.8)]"
          style={listItemHighlightStyle(regionBbox, hoveredListItemBbox)}
        />
      ) : null}

      {hasNote ? (
        <span
          className={cn(
            segmentIndicatorClassName('top-left', indicatorsExpanded),
            'bg-primary text-primary-foreground ring-primary/15'
          )}
          title="片段笔记"
        >
          <StickyNote size={11} aria-hidden="true" />
          {indicatorsExpanded ? <span className="pr-0.5">笔记</span> : null}
        </span>
      ) : null}

      {hasAnnotation ? (
        <span
          className={cn(
            segmentIndicatorClassName('top-right', indicatorsExpanded),
            'bg-warning text-white ring-warning/20'
          )}
          title="批注"
        >
          <MessageCircle size={11} aria-hidden="true" />
          {indicatorsExpanded ? <span className="pr-0.5">批注</span> : null}
        </span>
      ) : null}

      {sourceBacklinkCount > 0 ? (
        <span
          className={cn(
            segmentIndicatorClassName('bottom-left', indicatorsExpanded),
            'bg-success text-white ring-success/20'
          )}
          title={`${sourceBacklinkCount} 个来源链接`}
        >
          <Link2 size={11} aria-hidden="true" />
          {indicatorsExpanded ? <span className="pr-0.5">{sourceBacklinkCount}</span> : null}
        </span>
      ) : null}


      {active && previewPosition ? (
        <SegmentPreview
          isContinuation={isContinuation}
          listItemRegions={listItemRegions}
          pageIdx={pageIdx}
          position={previewPosition}
          showOriginal={previewShowOriginal}
          showNote={previewShowNote}
          showAnnotation={previewShowAnnotation}
          showTranslation={previewShowTranslation}
          noteText={previewNote}
          annotations={previewAnnotations}
          relatedImagePath={relatedImagePath}
          segment={segment}
          translatedText={translatedText}
          translationStatus={translationStatus}
          translationMode={translationMode}
          translationVisible={translationVisible}
          sourceEntryId={sourceEntryId}
          sourceLinkHint={sourceLinkHint}
          workspaceRoot={workspaceRoot}
          onListItemHover={setHoveredListItemBbox}
          onPointerEnter={onPreviewPointerEnter}
          onPointerLeave={onPreviewPointerLeave}
        />
      ) : null}
    </div>
  );
}


export const SegmentRegion = memo(
  SegmentRegionImpl,
  (previous, next) => {
    for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
      if (key.startsWith('on')) {
        continue;
      }
      if (previous[key] !== next[key]) {
        return false;
      }
    }
    return true;
  },
);

function listItemHighlightStyle(
  region: readonly [number, number, number, number],
  item: ListItemRegion['bbox'],
): CSSProperties {
  const width = Math.max(1, region[2] - region[0]);
  const height = Math.max(1, region[3] - region[1]);
  return {
    left: `${((item[0] - region[0]) / width) * 100}%`,
    top: `${((item[1] - region[1]) / height) * 100}%`,
    width: `${((item[2] - item[0]) / width) * 100}%`,
    height: `${((item[3] - item[1]) / height) * 100}%`,
  };
}

type ReplacementTextStyleInput = {
  height: number;
  segmentType: SourceSegment['segment_type'];
  text: string;
  width: number;
};

function segmentIndicatorClassName(
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  expanded: boolean
) {
  const cornerClass = {
    'top-left': 'left-0 top-0',
    'top-right': 'right-0 top-0',
    'bottom-left': 'bottom-0 left-0',
    'bottom-right': 'bottom-0 right-0'
  }[corner];
  const expandedTransform = {
    'top-left': '-ml-2 -translate-x-full -translate-y-6',
    'top-right': 'ml-2 translate-x-full -translate-y-6',
    'bottom-left': '-ml-2 -translate-x-full translate-y-6',
    'bottom-right': 'ml-2 translate-x-full translate-y-6'
  }[corner];

  return cn(
    'pointer-events-none absolute z-[4] inline-flex items-center justify-center rounded-full border border-white text-[10px] font-semibold shadow-sm ring-1 transition-all duration-150 ease-out overflow-hidden',
    cornerClass,
    expanded
      ? `h-5 min-w-5 gap-1 px-1 opacity-100 ${expandedTransform}`
      : 'size-1.5 min-w-0 gap-0 px-0 opacity-75'
  );
}

function buildReplacementTextStyle({
  height,
  segmentType,
  text,
  width
}: ReplacementTextStyleInput): CSSProperties {
  const isHeading = segmentType === 'heading';
  const isTable = segmentType === 'table';
  const measuredText = plainTextForMeasurement(text);
  const availableWidth = Math.max(REPLACEMENT_MIN_WIDTH, width - 2);
  const availableHeight = Math.max(REPLACEMENT_MIN_HEIGHT, height);

  if (width <= 0 || height <= 0) {
    return {
      fontSize: isHeading ? 18 : 12,
      fontWeight: isHeading ? 700 : 400,
      lineHeight: isHeading ? '20px' : '14px'
    };
  }

  const minSize = Math.max(6, Math.min(isHeading ? 11 : 8, Math.floor(availableHeight * 0.8)));
  const preferredMaxSize = isHeading ? 30 : isTable ? 16 : 21;
  const heightMaxSize = Math.max(minSize, Math.floor(availableHeight * (isHeading ? 0.78 : 0.72)));
  const maxSize = Math.max(minSize, Math.min(preferredMaxSize, heightMaxSize));

  for (let fontSize = maxSize; fontSize >= minSize; fontSize -= 1) {
    const lineHeight = replacementLineHeight(fontSize, isHeading);
    const estimatedHeight = estimateTextHeight(
      measuredText,
      availableWidth,
      fontSize,
      lineHeight
    );

    if (estimatedHeight <= availableHeight) {
      return {
        fontSize,
        fontWeight: isHeading ? 700 : 400,
        lineHeight: `${lineHeight}px`
      };
    }
  }

  return {
    fontSize: minSize,
    fontWeight: isHeading ? 700 : 400,
    lineHeight: `${replacementLineHeight(minSize, isHeading)}px`
  };
}

function replacementLineHeight(fontSize: number, isHeading: boolean) {
  return Math.max(fontSize + 1, Math.ceil(fontSize * (isHeading ? 1.08 : 1.12)));
}

function plainTextForMeasurement(text: string) {
  const normalized = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  if (/<[a-z][\s\S]*>/i.test(normalized) && typeof DOMParser !== 'undefined') {
    try {
      const document = new DOMParser().parseFromString(normalized, 'text/html');
      return (document.body.textContent ?? normalized).trim() || ' ';
    } catch {
      return normalized.replace(/<[^>]+>/g, ' ').trim() || ' ';
    }
  }

  return (
    normalized
      .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
      .replace(/[`*_#>|~-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || ' '
  );
}

function shouldMaskInTranslationMode(segment: SourceSegment) {
  return segment.segment_type !== 'figure' && segment.segment_type !== 'math';
}

function SegmentPreview({
  position,
  isContinuation,
  listItemRegions,
  pageIdx,
  relatedImagePath,
  segment,
  showOriginal,
  showNote,
  showAnnotation,
  showTranslation,
  noteText,
  annotations,
  translatedText,
  translationStatus,
  translationMode,
  translationVisible,
  sourceEntryId,
  sourceLinkHint,
  workspaceRoot,
  onListItemHover,
  onPointerEnter,
  onPointerLeave
}: {
  position: { x: number; y: number };
  isContinuation: boolean;
  listItemRegions: ListItemRegion[];
  pageIdx: number;
  relatedImagePath?: string | null;
  segment: SourceSegment;
  showOriginal: boolean;
  showNote: boolean;
  showAnnotation: boolean;
  showTranslation: boolean;
  noteText: string | null;
  annotations: Annotation[];
  translatedText: string | null;
  translationStatus: TranslationStatus | null;
  translationMode: 'replace' | 'hover';
  translationVisible: boolean;
  sourceEntryId: string;
  sourceLinkHint?: string;
  workspaceRoot: string | null;
  onListItemHover: (bbox: ListItemRegion['bbox'] | null) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  if (typeof document === 'undefined') {
    return null;
  }

  const originalText = segment.markdown ?? segment.text;
  const isScrollableList = segment.segment_type === 'list';
  const showTranslationPreview =
    showTranslation && translationVisible && Boolean(translatedText);
  const showNotePreview = showNote && Boolean(noteText?.trim());
  const showAnnotationPreview = showAnnotation && annotations.length > 0;
  const translationHint = getTranslationHint({
    showTranslation,
    translatedText,
    translationStatus
  });
  if (
    !showOriginal &&
    !showTranslationPreview &&
    !translationHint &&
    !showNotePreview &&
    !showAnnotationPreview
  ) {
    return null;
  }

  const layoutText = [
    showOriginal ? originalText : null,
    showTranslationPreview ? translatedText : null,
    showNotePreview ? noteText : null,
    showAnnotationPreview ? annotations.map((annotation) => annotation.content).join('\n') : null
  ]
    .filter(Boolean)
    .join('\n\n');
  const previewLayout = buildPreviewLayout({
    hasFooter: Boolean(
      sourceLinkHint || (translationVisible && translationMode === 'replace' && translatedText)
    ),
    position,
    preferScrollable: segment.segment_type === 'list',
    text: layoutText
  });

  return createPortal(
    <div
      className={cn(
        'fixed z-[var(--z-reader-preview)] block overflow-visible rounded-md border bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10',
        isScrollableList ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      style={{
        left: previewLayout.left,
        top: previewLayout.top,
        width: previewLayout.width
      }}
      onPointerEnter={isScrollableList ? onPointerEnter : undefined}
      onPointerLeave={isScrollableList ? onPointerLeave : undefined}
    >
      <div className="mb-1 flex items-center gap-2 px-2 pt-2">
        <Badge variant="secondary">
          {segmentDisplayLabel(segment)}
        </Badge>
        <span className="font-semibold">第 {pageIdx + 1} 页</span>
        {isContinuation ? (
          <span className="text-[11px] text-muted-foreground">续段推断</span>
        ) : null}
      </div>

      <div className="block min-w-0 overflow-visible px-2 pb-2 text-muted-foreground">
        <div className="space-y-3" style={previewLayout.contentStyle}>
          {showOriginal ? (
            <div>
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">解析后原文</div>
              {isScrollableList ? (
                <ListHoverPreview
                  regions={listItemRegions}
                  text={originalText}
                  onItemHover={onListItemHover}
                />
              ) : (
                <SourceSnapshotPreview
                  allowScroll={false}
                  compact
                  markdown={originalText}
                  relatedImagePath={relatedImagePath}
                  segmentType={segment.segment_type}
                  sourceEntryId={sourceEntryId}
                  workspaceRoot={workspaceRoot}
                />
              )}
            </div>
          ) : null}
          {showTranslationPreview && translatedText ? (
            <div className={showOriginal ? 'border-t pt-2' : ''}>
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">译文</div>
              <SourceSnapshotPreview
                allowScroll={false}
                compact
                markdown={translatedText}
                segmentType={segment.segment_type}
                sourceEntryId={sourceEntryId}
                workspaceRoot={workspaceRoot}
              />
            </div>
          ) : null}
          {showNotePreview && noteText ? (
            <div className={(showOriginal || showTranslationPreview) ? 'border-t pt-2' : ''}>
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">片段笔记</div>
              <SourceSnapshotPreview
                allowScroll={false}
                compact
                markdown={noteText}
                segmentType="paragraph"
                sourceEntryId={sourceEntryId}
                workspaceRoot={workspaceRoot}
              />
            </div>
          ) : null}
          {showAnnotationPreview ? (
            <div className={(showOriginal || showTranslationPreview || showNotePreview) ? 'border-t pt-2' : ''}>
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">批注</div>
              <div className="grid gap-1.5">
                {annotations.map((annotation) => (
                  <div className="rounded-sm border bg-background/70 px-2 py-1.5 text-xs leading-5" key={annotation.annotation_id}>
                    <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant="outline">{annotation.kind}</Badge>
                      <span>重要性 {annotation.importance}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-foreground">{annotation.content}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {translationHint ? (
            <div className={showOriginal ? 'border-t pt-2' : ''}>
              <div className="mb-1 text-[11px] font-semibold text-muted-foreground">译文</div>
              <p className="text-xs leading-5 text-muted-foreground">{translationHint}</p>
            </div>
          ) : null}
        </div>
      </div>

      {translationVisible && translationMode === 'replace' && translatedText ? (
        <div className="block border-t bg-muted/40 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
          当前覆盖显示译文，悬停预览保留解析后原文。
        </div>
      ) : null}

      {sourceLinkHint ? (
        <div className="block border-t bg-muted/40 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
          {sourceLinkHint}
        </div>
      ) : null}
    </div>,
    document.body
  );
}

function getTranslationHint({
  showTranslation,
  translatedText,
  translationStatus
}: {
  showTranslation: boolean;
  translatedText: string | null;
  translationStatus: TranslationStatus | null;
}) {
  if (!showTranslation || translatedText) {
    return null;
  }

  if (!translationStatus || translationStatus === 'idle') {
    return '尚未生成译文。请先在工具栏启动全文翻译。';
  }

  if (translationStatus === 'running') {
    return '译文仍在生成中，当前片段尚未完成翻译。';
  }

  if (translationStatus === 'partial' || translationStatus === 'failed') {
    return '当前片段没有可用译文。请继续或重试翻译任务。';
  }

  return '当前片段暂无译文。';
}

type PreviewLayoutInput = {
  hasFooter: boolean;
  position: { x: number; y: number };
  preferScrollable: boolean;
  text: string;
};

type PreviewLayout = {
  contentStyle: CSSProperties;
  left: number;
  top: number;
  width: number;
};

export function buildPreviewLayout({ hasFooter, position, preferScrollable, text }: PreviewLayoutInput): PreviewLayout {
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
  const maxWidth = Math.max(320, viewportWidth - PREVIEW_MARGIN * 2);
  const maxHeight = Math.max(260, viewportHeight - PREVIEW_MARGIN * 2);
  const hasTable = hasTableLikeContent(text);

  const candidates = (preferScrollable
    ? [{ columns: 1, fontSize: 12, lineHeight: 20, width: 480 }]
    : [
    { columns: 1, fontSize: 12, lineHeight: 20, width: 500 },
    { columns: 1, fontSize: 12, lineHeight: 20, width: 640 },
    { columns: hasTable ? 1 : 2, fontSize: 11, lineHeight: 18, width: 820 },
    { columns: hasTable ? 1 : 3, fontSize: 10, lineHeight: 16, width: 1040 },
    { columns: hasTable ? 1 : 4, fontSize: 9, lineHeight: 15, width: 1180 }
  ])
    .map((candidate) => ({
      ...candidate,
      width: Math.min(candidate.width, maxWidth)
    }))
    .map((candidate) => ({
      ...candidate,
      columns: Math.min(candidate.columns, maxColumnsForWidth(candidate.width))
    }))
    .filter((candidate, index, list) => {
      const previous = list[index - 1];
      return (
        !previous ||
        previous.width !== candidate.width ||
        previous.columns !== candidate.columns ||
        previous.fontSize !== candidate.fontSize
      );
    });

  const measuredCandidates = candidates.map((candidate) => {
    const contentWidth = Math.max(
      180,
      candidate.width - 16 - Math.max(0, candidate.columns - 1) * PREVIEW_COLUMN_GAP
    );
    const columnWidth = Math.max(160, contentWidth / candidate.columns);
    const textHeight = estimateTextHeight(text, columnWidth, candidate.fontSize, candidate.lineHeight);
    const chromeHeight = 52 + (hasFooter ? 30 : 0);
    const estimatedHeight = Math.ceil(textHeight / candidate.columns) + chromeHeight;

    return {
      ...candidate,
      estimatedHeight
    };
  });

  const selected =
    measuredCandidates.find((candidate) => candidate.estimatedHeight <= maxHeight) ??
    measuredCandidates[measuredCandidates.length - 1];

  const safeHeight = Math.min(selected.estimatedHeight, maxHeight);
  const pointerGap = 8;
  const rightSpace = viewportWidth - PREVIEW_MARGIN - position.x - pointerGap;
  const leftSpace = position.x - pointerGap - PREVIEW_MARGIN;
  const placeRight = rightSpace >= selected.width || rightSpace >= leftSpace;
  const preferredLeft = placeRight
    ? position.x + pointerGap
    : position.x - pointerGap - selected.width;
  const left = clamp(
    preferredLeft,
    PREVIEW_MARGIN,
    viewportWidth - selected.width - PREVIEW_MARGIN,
  );

  const belowSpace = viewportHeight - PREVIEW_MARGIN - position.y - pointerGap;
  const aboveSpace = position.y - pointerGap - PREVIEW_MARGIN;
  const placeBelow = belowSpace >= safeHeight || belowSpace >= aboveSpace;
  const preferredTop = placeBelow
    ? position.y + pointerGap
    : position.y - pointerGap - safeHeight;
  const top = clamp(
    preferredTop,
    PREVIEW_MARGIN,
    viewportHeight - safeHeight - PREVIEW_MARGIN,
  );

  return {
    contentStyle: {
      columnCount: preferScrollable ? undefined : selected.columns,
      columnFill: preferScrollable ? undefined : 'balance',
      columnGap: preferScrollable ? undefined : PREVIEW_COLUMN_GAP,
      fontSize: selected.fontSize,
      lineHeight: `${selected.lineHeight}px`,
      maxHeight: preferScrollable ? Math.min(420, maxHeight - 64) : undefined,
      overflowX: preferScrollable ? 'hidden' : undefined,
      overflowY: preferScrollable ? 'auto' : undefined,
      overscrollBehavior: preferScrollable ? 'contain' : undefined,
    },
    left,
    top,
    width: selected.width
  };
}

function estimateTextHeight(text: string, width: number, fontSize: number, lineHeight: number) {
  try {
    const prepared = prepare(text || ' ', `${fontSize}px ${PREVIEW_FONT_FAMILY}`, {
      whiteSpace: 'pre-wrap'
    });
    const measured = layout(prepared, width, lineHeight);
    return Math.max(lineHeight, Math.ceil(measured.height));
  } catch {
    const averageCharsPerLine = Math.max(20, Math.floor(width / Math.max(5, fontSize * 0.55)));
    const lineCount = text
      .split(/\r?\n/)
      .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / averageCharsPerLine)), 0);
    return Math.max(lineHeight, lineCount * lineHeight);
  }
}

function hasTableLikeContent(text: string) {
  return /<\/?table[\s>]/i.test(text) || /&lt;\/?table(?:\s|&gt;)/i.test(text) || /^\s*\|.+\|\s*$/m.test(text);
}

function maxColumnsForWidth(width: number) {
  return Math.max(1, Math.floor((width + PREVIEW_COLUMN_GAP) / (210 + PREVIEW_COLUMN_GAP)));
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
