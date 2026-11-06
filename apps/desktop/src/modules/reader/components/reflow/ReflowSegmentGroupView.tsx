import { InteractiveListContent, ListItemInteractionProvider } from './InteractiveListContent';
import { findSourceSegment, listItemAddress, requiresListItemChoice } from '@/shared/lib/listItemSegments';
import { isPdfBlockDragControl, usePdfBlockDrag } from '../pdf-reader/usePdfBlockDrag';
import { PdfBlockDragPreview } from '../pdf-reader/PdfBlockDragPreview';
import { PaperTextPreview as SourceSnapshotPreview } from '../navigation/PaperReferences';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createPortal } from "react-dom";
import { EyeOff, Link2, MessageCircle, StickyNote } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Badge } from "@/components/ui/badge";
import { useFoldReaderContext } from '../../folding/FoldReaderContext';
import { FoldedParagraph } from '../../folding/FoldedParagraph';
import { FoldTranslatedParagraph } from '../../folding/FoldTranslatedParagraph';
import type { FoldLevel } from '../../folding/useFoldReader';
import { SegmentFoldControls } from '../../folding/SegmentFoldControls';
import { FOLD_GESTURE_HINT, useFoldLevelGesture } from '../../folding/useFoldLevelGesture';
import { foldViewsForSource } from '../../folding/foldViews';
import { buildFoldInputs } from '../../folding/foldInput';
import { FoldTranslationButton } from '../../folding/FoldTranslationButton';
import { hoverInteractionBlocked } from '@/components/ui/hover-interactions';
import { cn } from "@/lib/utils";
import {
  resolveMineruAssetUrl,
} from "@/shared/components/SourceSnapshotPreview";
import { useToast } from "@/shared/hooks/useToast";
import type { TranslatedSegment } from "@/shared/ipc/workspaceApi";
import { reflowTextSizeScale } from "@/shared/lib/readerPreferences";
import type { Annotation, SegmentBlockNote, SourceSegment } from "@/shared/types/domain";

import {
  logicalSegmentUid,
  groupSegmentsByPage,
  inferPageCount,
  segmentDisplayLabel,
} from "../pdf-reader/readerUtils";
import { SegmentActionMenu } from "../pdf-reader/SegmentActionMenu";
import { useParagraphTranslation } from './ParagraphTranslationContext';
import { hasMatchingDocumentTranslation, paragraphTranslationRunning } from './paragraphTranslationState';
import { ParagraphTranslationActions } from './ParagraphTranslationControls';
import { SentenceAlignedTranslationContent } from './SentenceAlignedTranslationContent';
import { isVisualReflowComponent, resolveReflowContent, type ReflowContentPreference } from '@/shared/lib/reflowContentPreferences';
import { useReflowSegmentPreferences } from './ReflowSegmentPreferences';
import { ReflowSegmentContentActions, ReflowSegmentViewControls } from './ReflowContentControls';
import { ReflowContentLayers, parsedReflowMarkdown } from './ReflowContentLayers';
import type { ParagraphTranslation } from '@/shared/ipc/paragraphTranslationApi';
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

export type ReflowTranslationMode = "source" | "translation" | "bilingual" | "sentences";

import {
  warmReflowPreviewAssets,
  type ReflowPreviewPointerState
} from './ReflowSourcePreview';
import {
  reflowComponentKeyForGroup,
  reflowGroupTextScale,
  reflowGroupVisualSize,
  useReflowComponentPreferences
} from './ReflowComponentPreferencesContext';

export const ReflowSegmentGroupView = memo(function ReflowSegmentGroupView({
  active,
  activeSegmentUid,
  flashSegmentUid,
  focusedSentenceIndex,
  sentenceLinked = false,
  annotationsBySegmentUid,
  entryId,
  flashed,
  hoverPreviewEnabled,
  notesBySegmentUid,
  pdfDocument,
  pdfPreviewError,
  onRetryPdfPreview,
  reflowTranslationMode,
  segmentGroup,
  translationBySegmentUid,
  sourceLinkCountBySegmentUid,
  sourceBacklinksBySegmentUid,
  workspaceRoot,
  onActivateSegment,
  altClickOpensNote = false,
  onOpenSegmentAnnotation,
  onOpenSegmentNote,
  onPreviewChange,
  onRequirePdfDocument,
  onHideSegment,
  onAddSourceLink,
  onCopyContent,
  onCopySourceLink,
  onOpenSourceBacklink,
  onAddAssistantContext,
  onTranslateSegment,
}: {
  active: boolean;
  activeSegmentUid?: string | null;
  flashSegmentUid?: string | null;
  focusedSentenceIndex?: number;
  sentenceLinked?: boolean;
  annotationsBySegmentUid: Map<string, Annotation[]>;
  entryId: string;
  flashed: boolean;
  hoverPreviewEnabled: boolean;
  notesBySegmentUid: Map<string, SegmentBlockNote>;
  pdfDocument: PDFDocumentProxy | null;
  pdfPreviewError?: string | null;
  onRetryPdfPreview?: () => void;
  reflowTranslationMode: ReflowTranslationMode;
  segmentGroup: ReflowSegmentGroup;
  translationBySegmentUid: Map<string, TranslatedSegment>;
  sourceLinkCountBySegmentUid: Map<string, number>;
  sourceBacklinksBySegmentUid: SourceBacklinksBySegmentUid;
  workspaceRoot: string | null;
  onActivateSegment: (
    segment: SourceSegment,
    options?: { jumpToPdf?: boolean },
  ) => void;
  altClickOpensNote?: boolean;
  onOpenSegmentAnnotation: (segment: SourceSegment) => void;
  onOpenSegmentNote: (segment: SourceSegment) => void;
  onPreviewChange: (next: ReflowPreviewPointerState | null) => void;
  onRequirePdfDocument: () => void;
  onHideSegment: (segment: SourceSegment) => void;
  onAddSourceLink?: (segment: SourceSegment) => void;
  onCopyContent: (segment: SourceSegment) => void;
  onCopySourceLink: (segment: SourceSegment) => void;
  onOpenSourceBacklink: (backlink: SourceBacklink) => void;
  onAddAssistantContext?: (segment: SourceSegment) => void;
  onTranslateSegment?: (segment: SourceSegment) => void;
}) {
  const componentPreferences = useReflowComponentPreferences();
  const fold = useFoldReaderContext();
  const paragraphTranslation = useParagraphTranslation(segmentGroup.body);
  const segmentPreferences = useReflowSegmentPreferences(logicalSegmentUid(segmentGroup.body));
  const componentKey = reflowComponentKeyForGroup(segmentGroup);
  const componentContent = componentPreferences.content?.[componentKey];
  const resolvedContent = resolveReflowContent(componentKey, reflowTranslationMode, {
    ...componentContent,
  }, segmentPreferences.override);
  const foldActive = Boolean(fold && fold.level !== 'off' && segmentPreferences.override?.translationView !== 'sentences');
  const content = foldActive ? { ...resolvedContent, translationView: 'paragraph' as const } : resolvedContent;
  const foldRecord = segmentGroup.body.segment_type === 'paragraph' ? fold?.records[segmentGroup.body.uid] : undefined;
  const foldLevel = foldActive ? (fold?.overrides[segmentGroup.body.uid] ?? fold?.level ?? 'off') : 'off';
  const foldViews = useMemo(() => foldActive && foldRecord ? foldViewsForSource(foldRecord, segmentGroup.body.text) : null,
    [foldActive, foldRecord, segmentGroup.body.text]);
  const foldInput = useMemo(() => foldActive && segmentGroup.body.segment_type === 'paragraph'
    ? buildFoldInputs([segmentGroup.body]) : null, [foldActive, segmentGroup.body]);
  const foldEligible = Boolean(foldInput?.batches.length);
  const foldTooShort = foldInput?.skipped[0]?.reason === 'too_short';
  // A new minimum does not discard results the reader already generated.
  const foldAvailable = Boolean((foldEligible || foldTooShort) && foldViews && foldLevel !== 'off');
  const foldedContent = foldAvailable && foldRecord && foldLevel !== 'off'
    ? <FoldedParagraph record={foldRecord} source={segmentGroup.body.text.trim()} level={foldLevel} views={foldViews} globalLevel={fold?.level} /> : undefined;
  const candidateTranslation = foldRecord && foldLevel !== 'off' && foldLevel !== 'full'
    ? foldRecord.translations?.[foldLevel] : undefined;
  const foldTranslation = candidateTranslation && foldLevel !== 'off' && foldLevel !== 'full'
    && candidateTranslation.source_text === foldViews?.[foldLevel].text ? candidateTranslation : undefined;
  const componentTextScale = reflowGroupTextScale(segmentGroup, componentPreferences);
  const relatedImagePath =
    segmentGroup.assetPath ?? segmentGroup.body.asset_path ?? null;
  const hasNote = segmentGroup.segments.some((segment) =>
    notesBySegmentUid.has(segment.uid),
  );
  const annotationCount = segmentGroup.segments.reduce(
    (total, segment) => total + (annotationsBySegmentUid.get(segment.uid)?.length ?? 0),
    0,
  );
  const sourceLinkCount = segmentGroup.segments.reduce(
    (total, segment) => total + (sourceLinkCountBySegmentUid.get(segment.uid) ?? 0),
    0,
  );
  const isHeading = segmentGroup.body.segment_type === "heading";
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [menuSegment, setMenuSegment] = useState(segmentGroup.body);
  const blockDrag = usePdfBlockDrag(`${workspaceRoot}:${entryId}:${segmentGroup.body.uid}`, Boolean(onAddAssistantContext));
  const targetSegment = (target: EventTarget | null) => {
    const uid = target instanceof Element ? target.closest<HTMLElement>('[data-reflow-list-item]')?.dataset.reflowListItem : undefined;
    return (uid && findSourceSegment(segmentGroup.segments, uid)) || segmentGroup.body;
  };
  const [isHiding, setIsHiding] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const foldGestureEnabled = foldAvailable && !isHiding && !menuPosition;
  const foldGestureRef = useFoldLevelGesture({
    enabled: foldGestureEnabled, level: foldLevel, scope: `${workspaceRoot}:${entryId}:${segmentGroup.body.uid}`,
    onChange: level => fold?.setOverride(segmentGroup.body.uid, level), onInteraction: () => onPreviewChange(null)
  });

  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    },
    [],
  );

  const updatePreview = (
    event: ReactMouseEvent<HTMLElement>,
    segment = segmentGroup.body,
  ) => {
    if ((event.target as Element).closest('[data-paper-reference]')) { onPreviewChange(null); return; }
    if (!hoverPreviewEnabled || event.buttons !== 0 || hoverInteractionBlocked()) {
      onPreviewChange(null);
      return;
    }

    warmReflowPreviewAssets({
      entryId,
      markdown: segment.markdown ?? segment.text,
      pdfDocument,
      relatedImagePath,
      segment,
      workspaceRoot,
    });
    if (!pdfDocument && segment.bbox) {
      onRequirePdfDocument();
    }
    onPreviewChange({
      position: { x: event.clientX, y: event.clientY },
      relatedImagePath,
      segment,
    });
  };

  const hideWithAnimation = () => {
    if (isHiding) {
      return;
    }
    setIsHiding(true);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      onHideSegment(segmentGroup.body);
    }, 180);
  };

  return (
    <ListItemInteractionProvider value={{ activeUid: activeSegmentUid, flashUid: flashSegmentUid,
      dragUid: blockDrag.dragItem?.segment.uid, translations: translationBySegmentUid }}>
    <section
      ref={foldGestureRef}
      aria-description={foldGestureEnabled ? FOLD_GESTURE_HINT : undefined}
      aria-keyshortcuts={foldGestureEnabled ? 'Control+ArrowUp Control+ArrowDown' : undefined}
      className={cn(
        "group reflow-segment relative min-w-0 scroll-mt-3 border-b border-border/65 px-2 py-4 outline-none transition-[background-color,opacity,transform] duration-200",
        isHeading && "border-t pt-9 pb-3",
        active && !sentenceLinked && focusedSentenceIndex === undefined && "bg-primary/5",
        flashed && !sentenceLinked && focusedSentenceIndex === undefined && "segment-navigation-highlight",
        isHiding && "-translate-x-2 scale-[0.99] opacity-0",
      )}
      id={`reflow-segment-${segmentGroup.body.uid}`}
      style={{ fontSize: `${componentTextScale}em` }}
      tabIndex={0}
      {...blockDrag.pointerHandlers}
      onPointerDownCapture={event => {
        const segment = targetSegment(event.target);
        if (event.button === 0 && event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !isPdfBlockDragControl(event.target) && requiresListItemChoice(segment)) {
          event.preventDefault(); event.stopPropagation(); onPreviewChange(null);
          setMenuSegment(segment); setMenuPosition({ x: event.clientX, y: event.clientY });
          return;
        }
        if (blockDrag.start(event, { entryId, workspaceRoot, segment,
          bbox: segment.bbox?.length === 4 ? segment.bbox as [number, number, number, number] : [0, 0, 1000, 1000] })) {
          onPreviewChange(null);
          setMenuPosition(null);
        }
      }}
      onClick={(event) => {
        if (blockDrag.consumeClick()) { event.preventDefault(); event.stopPropagation(); return; }
        if ((event.target as Element).closest('button, a, input, textarea, [data-paper-reference]')) return;
        const selection = window.getSelection();
        if (selection?.toString().trim() && selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) return;
        const segment = targetSegment(event.target);
        if (requiresListItemChoice(segment)) {
          setMenuSegment(segment); setMenuPosition({ x: event.clientX, y: event.clientY }); return;
        }
        if (altClickOpensNote && event.altKey) {
          onOpenSegmentNote(segment);
          return;
        }
        onActivateSegment(segment, { jumpToPdf: true });
      }}
      onContextMenu={(event) => {
        const selection = window.getSelection();
        if (selection?.toString().trim() && selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) return;
        event.preventDefault();
        setMenuSegment(targetSegment(event.target));
        onPreviewChange(null);
        setMenuPosition({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget && !(event.target as HTMLElement).hasAttribute('data-reflow-list-item')) return;
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          event.preventDefault();
          const bounds = (event.target as HTMLElement).getBoundingClientRect();
          setMenuSegment(targetSegment(event.target));
          setMenuPosition({ x: bounds.left + 16, y: bounds.top + 24 });
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const segment = targetSegment(event.target);
          if (requiresListItemChoice(segment)) {
            const bounds = (event.target as HTMLElement).getBoundingClientRect();
            setMenuSegment(segment); setMenuPosition({ x: bounds.left + 16, y: bounds.top + 24 });
          } else onActivateSegment(segment, { jumpToPdf: true });
        }
      }}
      onMouseLeave={
        hoverPreviewEnabled ? () => onPreviewChange(null) : undefined
      }
      onMouseMove={
        hoverPreviewEnabled
          ? (event) => {
              if (segmentGroup.body.segment_type === "list") {
                onPreviewChange(null);
                return;
              }
              updatePreview(event);
            }
          : undefined
      }
    >
      <PdfBlockDragPreview item={blockDrag.dragItem} preview={blockDrag.preview} showSource={false} />
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 z-[1] w-12 -translate-x-12"
        onMouseMove={(event) => { event.stopPropagation(); onPreviewChange(null); }}
      />
      <button
        className="pointer-events-none absolute left-0 top-4 z-[2] grid size-6 -translate-x-[calc(100%+0.75rem)] place-items-center rounded-sm border bg-background/95 text-muted-foreground opacity-0 shadow-sm ring-1 ring-foreground/5 transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        title="隐藏此重排元素"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          hideWithAnimation();
        }}
        onMouseMove={(event) => { event.stopPropagation(); onPreviewChange(null); }}
      >
        <EyeOff size={13} aria-hidden="true" />
      </button>
      <div className="min-w-0">
        <div className="reflow-segment-metadata mb-2 flex min-w-0 items-center gap-1.5 overflow-x-auto py-0.5 text-xs text-muted-foreground">
          <Badge variant="outline" className="h-6 shrink-0">
            {segmentDisplayLabel(segmentGroup.body)}
          </Badge>
          <span className="shrink-0 whitespace-nowrap">第 {segmentGroup.body.page_idx + 1} 页</span>
          {componentKey === 'paragraph' && <ReflowSegmentViewControls
            value={segmentPreferences.override?.translationView ?? 'inherit'} onInteraction={() => onPreviewChange(null)}
            onChange={view => segmentPreferences.update(view === 'inherit' ? { translationView: undefined }
              : { translationView: view })} />}
          {foldActive && segmentGroup.body.segment_type === 'paragraph' && <SegmentFoldControls
            value={fold?.overrides[segmentGroup.body.uid] ?? 'inherit'} globalLevel={fold?.level ?? 'off'}
            eligible={foldEligible || foldAvailable} available={foldAvailable} onChange={value => fold?.setOverride(segmentGroup.body.uid, value)}
            onInteraction={() => onPreviewChange(null)} />}
          <div className="ml-auto flex shrink-0 items-center gap-1.5" data-reflow-metadata-trailing>
          {hasNote ? (
            <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/10">
              <StickyNote size={11} />
              Note
            </Badge>
          ) : null}
          {sourceLinkCount > 0 ? (
            <Badge className="gap-1 bg-success-surface text-success hover:bg-success-surface">
              <Link2 size={11} />
              Reference {sourceLinkCount}
            </Badge>
          ) : null}
          {annotationCount > 0 ? (
            <Badge className="gap-1 bg-warning-surface text-warning hover:bg-warning-surface">
              <MessageCircle size={11} />
              Annotation {annotationCount}
            </Badge>
          ) : null}
          <MineruMetadataBadges segment={segmentGroup.body} />
          </div>
        </div>

          <div data-reading-selection-source={foldAvailable && foldLevel !== 'full' ? undefined : segmentGroup.body.uid}>
          <ReflowGroupContent
            content={content}
            paragraphRecord={paragraphTranslation.record}
            focusedSentenceIndex={focusedSentenceIndex}
            onEnhance={paragraphTranslation.context?.ready ? () => {
              if (paragraphTranslation.context?.pending.has(segmentGroup.body.uid) || paragraphTranslationRunning(paragraphTranslation.record)) return;
              segmentPreferences.update({ translation: true, translationView: 'sentences' });
              paragraphTranslation.context?.translate(segmentGroup.body.uid, true);
            } : undefined}
            enhancing={Boolean(paragraphTranslation.context?.pending.has(segmentGroup.body.uid) || paragraphTranslationRunning(paragraphTranslation.record))}
            pdfError={pdfPreviewError}
            onRetryPdf={onRetryPdfPreview}
            entryId={entryId}
            reflowTranslationMode={reflowTranslationMode}
            relatedImagePath={relatedImagePath}
            pdfDocument={pdfDocument}
            hoverPreviewEnabled={hoverPreviewEnabled}
            segmentGroup={segmentGroup}
            translationBySegmentUid={translationBySegmentUid}
            workspaceRoot={workspaceRoot}
            onPreviewChange={onPreviewChange}
            onRequirePdfDocument={onRequirePdfDocument}
            foldedContent={foldedContent}
            globalFoldLevel={fold?.level}
            foldedTranslationMissing={Boolean(foldAvailable && foldLevel !== 'full')}
            foldedTranslation={foldTranslation?.translated_text}
            foldTranslationAction={foldAvailable && foldRecord && foldLevel !== 'off' && foldLevel !== 'full' && fold ?
              <FoldTranslationButton key={`${segmentGroup.body.uid}:${foldLevel}`} root={workspaceRoot} entryId={entryId} title={fold.title} record={foldRecord} level={foldLevel} /> : undefined}
          />
          </div>
          {foldAvailable && foldRecord && foldLevel !== 'full' ? <details className="mt-2 text-xs text-muted-foreground" onClick={event => event.stopPropagation()}>
            <summary className="cursor-pointer">查看原文依据</summary>
            <div className="mt-1 space-y-1">{foldRecord.brief.map((sentence, index) =>
              <div key={foldRecord.evidence[index]} className="whitespace-pre-wrap" data-reading-selection-source={segmentGroup.body.uid}>{sentence}</div>)}</div>
            {foldEligible ? <button type="button" className="mt-1 text-primary underline" disabled={fold?.running} onClick={event => { event.stopPropagation(); fold?.start([segmentGroup.body], true); }}>重新生成本段</button> : null}
          </details> : foldActive && foldLevel !== 'full' && segmentGroup.body.segment_type === 'paragraph' && !foldAvailable ? <p className="mt-1 text-xs text-muted-foreground">{foldEligible ? '此段暂无详略，显示完整原文。' : foldTooShort ? '此段较短，保留原文。' : '此段不适合折叠，保留原文。'} {foldEligible ? <button type="button" className="text-primary underline" disabled={fold?.running} onClick={event => { event.stopPropagation(); fold?.start([segmentGroup.body]); }}>生成本段</button> : null}</p> : null}
      </div>
      {menuPosition ? (
        <SegmentActionMenu
          canAddSourceLink={Boolean(onAddSourceLink)}
          canCopyContent={true}
          canCopySourceLink={true}
          position={menuPosition}
          segment={menuSegment}
          wholeListSegment={listItemAddress(menuSegment.uid) ? segmentGroup.body : undefined}
          sourceBacklinks={
            sourceBacklinksBySegmentUid[menuSegment.uid] ??
            sourceBacklinksBySegmentUid[logicalSegmentUid(menuSegment)] ??
            []
          }
          onClose={() => setMenuPosition(null)}
          onOpenSegmentAnnotation={onOpenSegmentAnnotation}
          onOpenSegmentNote={onOpenSegmentNote}
          onAddSourceLink={onAddSourceLink}
          onCopyContent={onCopyContent}
          onCopySourceLink={onCopySourceLink}
          onAddAssistantContext={onAddAssistantContext}
          onTranslateSegment={onTranslateSegment}
          displayActions={listItemAddress(menuSegment.uid) ? undefined : <ReflowSegmentContentActions component={componentKey} value={content} overridden={Boolean(segmentPreferences.override)}
            onChange={patch => {
              segmentPreferences.update(patch);
              setMenuPosition(null);
            }} />}
          translationActions={paragraphTranslation.context ? <ParagraphTranslationActions segment={segmentGroup.body} close={() => setMenuPosition(null)}
            hasDocumentTranslation={hasMatchingDocumentTranslation(segmentGroup.body, translationBySegmentUid.get(segmentGroup.body.uid))}
            viewControls={false} onTranslate={view => { segmentPreferences.update({ translation: true, translationView: view ?? 'sentences' }); }} /> : undefined}
          onHideSegment={listItemAddress(menuSegment.uid) ? undefined : onHideSegment}
          onOpenSourceBacklink={onOpenSourceBacklink}
        />
      ) : null}
    </section>
    </ListItemInteractionProvider>
  );
});

function ReflowGroupContent({
  content,
  paragraphRecord,
  focusedSentenceIndex,
  onEnhance,
  enhancing,
  pdfError,
  onRetryPdf,
  entryId,
  reflowTranslationMode,
  relatedImagePath,
  pdfDocument,
  hoverPreviewEnabled,
  segmentGroup,
  translationBySegmentUid,
  workspaceRoot,
  onPreviewChange,
  onRequirePdfDocument,
  foldedContent,
  globalFoldLevel,
  foldedTranslationMissing,
  foldedTranslation,
  foldTranslationAction,
}: {
  content: ReflowContentPreference;
  paragraphRecord?: ParagraphTranslation;
  focusedSentenceIndex?: number;
  onEnhance?: () => void;
  enhancing: boolean;
  pdfError?: string | null;
  onRetryPdf?: () => void;
  entryId: string;
  reflowTranslationMode: ReflowTranslationMode;
  relatedImagePath: string | null;
  pdfDocument: PDFDocumentProxy | null;
  hoverPreviewEnabled: boolean;
  segmentGroup: ReflowSegmentGroup;
  translationBySegmentUid: Map<string, TranslatedSegment>;
  workspaceRoot: string | null;
  onPreviewChange: (next: ReflowPreviewPointerState | null) => void;
  onRequirePdfDocument: () => void;
  foldedContent?: React.ReactNode;
  globalFoldLevel?: FoldLevel;
  foldedTranslationMissing?: boolean;
  foldedTranslation?: string;
  foldTranslationAction?: React.ReactNode;
}) {
  const componentPreferences = useReflowComponentPreferences();
  const segment = segmentGroup.body;
  const documentTranslation = translationBySegmentUid.get(segment.uid);
  const savedTranslation = hasMatchingDocumentTranslation(segment, documentTranslation)
    ? documentTranslation?.translated_text
    : paragraphRecord?.paragraph.status === 'succeeded' ? paragraphRecord.paragraph.value : null;
  const pairedContent = segment.segment_type !== 'paragraph' ? undefined : content.translationView === 'sentences'
    ? <SentenceAlignedTranslationContent source={segment.markdown ?? segment.text} savedTranslation={savedTranslation}
        showOriginal={content.parsed} showTranslation={content.translation} entryId={entryId} workspaceRoot={workspaceRoot}
        segmentUid={segment.uid} focusedSentenceIndex={focusedSentenceIndex}
        onEnhance={content.translation && !savedTranslation ? onEnhance : undefined} enhancing={enhancing}
        aiError={paragraphRecord?.paragraph.status === 'failed' ? paragraphRecord.paragraph.error : null} />
    : undefined;

  return (
    <div className="grid min-w-0 gap-3">
      {content.translation && documentTranslation?.status === 'failed' && <p role="status" className="text-xs text-warning">本段翻译未完成：{documentTranslation.error ?? '请重试本段'}。其他段落继续处理，可在翻译任务中重试。</p>}
      <ReflowContentLayers
        entryId={entryId}
        content={content}
        pdfDocument={pdfDocument}
        pdfError={pdfError}
        onRequirePdfDocument={onRequirePdfDocument}
        onRetryPdf={onRetryPdf}
        imageDetailEnabled={componentPreferences.imageClickToOpen}
        size={reflowGroupVisualSize(segmentGroup, componentPreferences)}
        parsedContent={foldedContent ?? (isVisualReflowComponent(reflowComponentKeyForGroup(segmentGroup)) ? undefined : <TextReflowContent
          entryId={entryId} hoverPreviewEnabled={hoverPreviewEnabled} onPreviewChange={onPreviewChange} pdfDocument={pdfDocument}
          reflowTranslationMode="source" relatedImagePath={null}
          segment={{ ...segmentGroup.body, markdown: parsedReflowMarkdown(segmentGroup.body.markdown ?? segmentGroup.body.text) }}
          translatedText={null} workspaceRoot={workspaceRoot} />)}
        translationContent={foldedTranslationMissing && foldedTranslation && !/[*_`]|\]\(|<[^>]+>/.test(foldedTranslation) ? <FoldTranslatedParagraph text={foldedTranslation} globalLevel={globalFoldLevel} /> : isVisualReflowComponent(reflowComponentKeyForGroup(segmentGroup)) ? undefined : <TextReflowContent
          entryId={entryId} hoverPreviewEnabled={hoverPreviewEnabled} onPreviewChange={onPreviewChange} pdfDocument={pdfDocument}
          reflowTranslationMode="translation" relatedImagePath={null} segment={segmentGroup.body}
          translatedText={foldedTranslationMissing ? foldedTranslation ?? null : savedTranslation ?? null} workspaceRoot={workspaceRoot} />}
        pairedContent={pairedContent}
        relatedImagePath={relatedImagePath}
        segment={segmentGroup.body}
        translatedText={
          foldedTranslationMissing ? foldedTranslation ?? null : savedTranslation ?? null
        }
        translationEmptyMessage={foldedTranslationMissing ? '当前详略暂无对应译文。' : undefined}
        translationMissingAction={foldedTranslationMissing ? foldTranslationAction : undefined}
        workspaceRoot={workspaceRoot}
      />

      {componentPreferences.supportingText.visible ? segmentGroup.captions.map((caption) => (
        <RoleText
          key={caption.uid}
          label={segmentDisplayLabel(caption)}
          entryId={entryId}
          hoverPreviewEnabled={hoverPreviewEnabled}
          reflowTranslationMode={reflowTranslationMode}
          relatedImagePath={relatedImagePath}
          pdfDocument={pdfDocument}
          segment={caption}
          translatedText={
            translationBySegmentUid.get(caption.uid)?.translated_text ?? null
          }
          workspaceRoot={workspaceRoot}
          onPreviewChange={onPreviewChange}
          onRequirePdfDocument={onRequirePdfDocument}
        />
      )) : null}

      {componentPreferences.supportingText.visible ? segmentGroup.footnotes.map((footnote) => (
        <RoleText
          key={footnote.uid}
          label={segmentDisplayLabel(footnote)}
          entryId={entryId}
          hoverPreviewEnabled={hoverPreviewEnabled}
          reflowTranslationMode={reflowTranslationMode}
          relatedImagePath={relatedImagePath}
          pdfDocument={pdfDocument}
          segment={footnote}
          subtle
          translatedText={
            translationBySegmentUid.get(footnote.uid)?.translated_text ?? null
          }
          workspaceRoot={workspaceRoot}
          onPreviewChange={onPreviewChange}
          onRequirePdfDocument={onRequirePdfDocument}
        />
      )) : null}
    </div>
  );
}

function TextReflowContent({
  entryId,
  hoverPreviewEnabled,
  onPreviewChange,
  pdfDocument,
  reflowTranslationMode,
  relatedImagePath,
  segment,
  translatedText,
  workspaceRoot,
}: {
  entryId: string;
  hoverPreviewEnabled: boolean;
  onPreviewChange: (next: ReflowPreviewPointerState | null) => void;
  pdfDocument: PDFDocumentProxy | null;
  reflowTranslationMode: ReflowTranslationMode;
  relatedImagePath: string | null;
  segment: SourceSegment;
  translatedText: string | null;
  workspaceRoot: string | null;
}) {
  const componentPreferences = useReflowComponentPreferences();
  const text = segment.markdown ?? segment.text;

  if (segment.segment_type === "heading") {
    return (
      <div className={headingClassName(segment)}>
        <SegmentText
          entryId={entryId}
          originalText={text}
          reflowTranslationMode={reflowTranslationMode}
          segment={segment}
          translatedText={translatedText}
          workspaceRoot={workspaceRoot}
        />
      </div>
    );
  }

  if (segment.segment_type === "list") {
    return (
      <div className="min-w-0 text-[1em] leading-relaxed text-foreground">
        <InteractiveListContent
          entryId={entryId}
          hoverPreviewEnabled={hoverPreviewEnabled}
          onPreviewChange={onPreviewChange}
          pdfDocument={pdfDocument}
          reflowTranslationMode={reflowTranslationMode}
          relatedImagePath={relatedImagePath}
          segment={segment}
          translatedText={translatedText}
          workspaceRoot={workspaceRoot}
        />
      </div>
    );
  }

  if (segment.segment_type === "code") {
    return (
      <div className="min-w-0 text-[0.8125em] leading-normal">
        <SegmentText
          entryId={entryId}
          originalText={text}
          reflowTranslationMode={reflowTranslationMode}
          segment={segment}
          translatedText={translatedText}
          workspaceRoot={workspaceRoot}
        />
      </div>
    );
  }

  if (segment.segment_type === "math") {
    return (
      <div className="min-w-0 text-[1em] leading-relaxed">
        <SegmentText
          entryId={entryId}
          originalText={text}
          reflowTranslationMode={reflowTranslationMode}
          relatedImagePath={relatedImagePath}
          segment={segment}
          translatedText={translatedText}
          workspaceRoot={workspaceRoot}
        />
      </div>
    );
  }

  if (
    segment.segment_type === "page_footnote" ||
    segment.segment_type === "aside_text"
  ) {
    return (
      <div className="min-w-0 border-l-2 border-muted-foreground/25 pl-3 text-[0.875em] text-muted-foreground">
        <SourceSnapshotPreview
          allowScroll={false}
          compact
          markdown={displayTextForMode(
            text,
            translatedText,
            reflowTranslationMode,
          )}
          segmentType={segment.segment_type}
          sourceEntryId={entryId}
          showMermaidDiagrams
          workspaceRoot={workspaceRoot}
        />
      </div>
    );
  }

  return (
    <SegmentText
      entryId={entryId}
      originalText={text}
      reflowTranslationMode={reflowTranslationMode}
      relatedImagePath={relatedImagePath}
      segment={segment}
      translatedText={translatedText}
      workspaceRoot={workspaceRoot}
    />
  );
}

function MineruMetadataBadges({ segment }: { segment: SourceSegment }) {
  const metadata = segment.mineru_metadata ?? {};
  const items = [
    segment.raw_type ? `MinerU: ${segment.raw_type}` : null,
    segment.sub_type ?? metadata.sub_type ?? null,
    metadata.level ? `Level ${metadata.level}` : null,
    metadata.list_type ?? null,
    metadata.table_type ?? null,
    metadata.math_type ?? null,
    metadata.code_language ?? metadata.language ?? metadata.lang ?? null,
    metadata.anchor ? `Anchor ${metadata.anchor}` : null,
    metadata.angle ? `Angle ${metadata.angle}` : null,
  ].filter(Boolean) as string[];

  if (items.length === 0) {
    return null;
  }

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {items.slice(0, 4).map((item) => (
        <Badge
          className="max-w-[160px] truncate bg-muted text-muted-foreground hover:bg-muted"
          key={item}
          title={item}
        >
          {item}
        </Badge>
      ))}
    </span>
  );
}

function headingClassName(segment: SourceSegment) {
  const level = Number(segment.mineru_metadata?.level ?? 2);
  return cn(
    "min-w-0 break-words font-semibold leading-snug text-foreground",
    level <= 1 && "text-[1.5em]",
    level === 2 && "text-[1.25em]",
    level === 3 && "text-[1.125em]",
    level >= 4 && "text-[1em]",
  );
}

function RoleText({
  entryId,
  hoverPreviewEnabled,
  label,
  reflowTranslationMode,
  relatedImagePath,
  pdfDocument,
  segment,
  subtle = false,
  translatedText,
  workspaceRoot,
  onPreviewChange,
  onRequirePdfDocument,
}: {
  entryId: string;
  hoverPreviewEnabled: boolean;
  label: string;
  reflowTranslationMode: ReflowTranslationMode;
  relatedImagePath?: string | null;
  pdfDocument: PDFDocumentProxy | null;
  segment: SourceSegment;
  subtle?: boolean;
  translatedText: string | null;
  workspaceRoot: string | null;
  onPreviewChange: (next: ReflowPreviewPointerState | null) => void;
  onRequirePdfDocument: () => void;
}) {
  const componentPreferences = useReflowComponentPreferences();
  const content = resolveReflowContent('supportingText', reflowTranslationMode, componentPreferences.content?.supportingText);
  if (!content.image && !content.parsed && !content.translation) return null;
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-sm border-l-2 px-3 py-2",
        subtle
          ? "bg-muted/30 text-[0.75em] text-muted-foreground"
          : "bg-muted/40 text-[0.875em]",
      )}
      style={{ fontSize: `${reflowTextSizeScale(componentPreferences.supportingText.size)}em` }}
      onMouseMove={(event) => {
        event.stopPropagation();
        if (!hoverPreviewEnabled || event.buttons !== 0 || hoverInteractionBlocked()) {
          onPreviewChange(null);
          return;
        }
        warmReflowPreviewAssets({
          entryId,
          markdown: segment.markdown ?? segment.text,
          pdfDocument,
          relatedImagePath,
          segment,
          workspaceRoot,
        });
        if (!pdfDocument && segment.bbox) {
          onRequirePdfDocument();
        }
        onPreviewChange({
          position: { x: event.clientX, y: event.clientY },
          relatedImagePath,
          segment,
        });
      }}
    >
      <div className="mb-1 text-[11px] font-semibold text-muted-foreground">
        {label}
      </div>
      <ReflowContentLayers entryId={entryId} content={content} relatedImagePath={segment.asset_path ?? null} segment={segment}
        translatedText={translatedText} workspaceRoot={workspaceRoot} pdfDocument={pdfDocument} onRequirePdfDocument={onRequirePdfDocument}
        size="standard" imageDetailEnabled={componentPreferences.imageClickToOpen} />
    </div>
  );
}

function SegmentText({
  entryId,
  imageDetailEnabled = false,
  imageSize = 'standard',
  originalText,
  reflowTranslationMode,
  relatedImagePath,
  segment,
  translatedText,
  workspaceRoot,
}: {
  entryId: string;
  imageDetailEnabled?: boolean;
  imageSize?: 'compact' | 'standard' | 'large' | 'full';
  originalText: string;
  reflowTranslationMode: ReflowTranslationMode;
  relatedImagePath?: string | null;
  segment: SourceSegment;
  translatedText: string | null;
  workspaceRoot: string | null;
}) {
  const componentPreferences = useReflowComponentPreferences();
  if (reflowTranslationMode === "translation") {
    return (
      <SourceSnapshotPreview
        allowScroll={false}
        imageDetailEnabled={imageDetailEnabled}
        imageSize={imageSize}
        markdown={translatedText?.trim() || originalText}
        relatedImagePath={relatedImagePath}
        segmentType={segment.segment_type}
        sourceEntryId={entryId || null}
        showMermaidDiagrams
        workspaceRoot={workspaceRoot}
      />
    );
  }

  if ((reflowTranslationMode === "bilingual" || reflowTranslationMode === "sentences") && translatedText?.trim()) {
    return (
      <div className="grid min-w-0 gap-2">
        <SourceSnapshotPreview
          allowScroll={false}
          imageDetailEnabled={imageDetailEnabled}
          imageSize={imageSize}
          markdown={originalText}
          relatedImagePath={relatedImagePath}
          segmentType={segment.segment_type}
          sourceEntryId={entryId || null}
          showMermaidDiagrams
          workspaceRoot={workspaceRoot}
        />
        <div className="min-w-0 border-t pt-2 text-[0.95em] text-muted-foreground">
          <SourceSnapshotPreview
            allowScroll={false}
            markdown={translatedText}
            segmentType={segment.segment_type}
            sourceEntryId={entryId || null}
            showMermaidDiagrams
            workspaceRoot={workspaceRoot}
          />
        </div>
      </div>
    );
  }

  return (
    <SourceSnapshotPreview
      allowScroll={false}
      imageDetailEnabled={imageDetailEnabled}
      imageSize={imageSize}
      markdown={originalText}
      relatedImagePath={relatedImagePath}
      segmentType={segment.segment_type}
      sourceEntryId={entryId || null}
      showMermaidDiagrams
      workspaceRoot={workspaceRoot}
    />
  );
}

function displayTextForMode(
  originalText: string,
  translatedText: string | null,
  mode: ReflowTranslationMode,
) {
  if (mode === "translation") {
    return translatedText?.trim() || originalText;
  }
  if (mode === "bilingual" && translatedText?.trim()) {
    return `${originalText}\n\n---\n\n${translatedText}`;
  }
  return originalText;
}
