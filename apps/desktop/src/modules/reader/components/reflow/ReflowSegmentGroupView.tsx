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

import {
  warmReflowPreviewAssets,
  type ReflowPreviewPointerState
} from './ReflowSourcePreview';

export const ReflowSegmentGroupView = memo(function ReflowSegmentGroupView({
  active,
  annotationsBySegmentUid,
  entryId,
  flashed,
  hoverPreviewEnabled,
  notesBySegmentUid,
  pdfDocument,
  reflowTranslationMode,
  segmentGroup,
  translationBySegmentUid,
  sourceLinkCountBySegmentUid,
  sourceBacklinksBySegmentUid,
  workspaceRoot,
  onActivateSegment,
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
  annotationsBySegmentUid: Map<string, Annotation[]>;
  entryId: string;
  flashed: boolean;
  hoverPreviewEnabled: boolean;
  notesBySegmentUid: Map<string, SegmentBlockNote>;
  pdfDocument: PDFDocumentProxy | null;
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
  const [isHiding, setIsHiding] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

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
    if (!hoverPreviewEnabled) {
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
    <section
      className={cn(
        "group relative min-w-0 scroll-mt-3 border-b border-border/65 px-2 py-4 outline-none transition-[background-color,opacity,transform] duration-200",
        isHeading && "border-t pt-9 pb-3",
        active && "bg-primary/5",
        flashed && "segment-navigation-highlight",
        isHiding && "-translate-x-2 scale-[0.99] opacity-0",
      )}
      id={`reflow-segment-${segmentGroup.body.uid}`}
      tabIndex={0}
      onClick={() => onActivateSegment(segmentGroup.body, { jumpToPdf: true })}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuPosition({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivateSegment(segmentGroup.body, { jumpToPdf: true });
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
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 z-[1] w-12 -translate-x-12"
        onMouseMove={(event) => event.stopPropagation()}
      />
      <button
        className="pointer-events-none absolute left-0 top-4 z-[2] grid size-6 -translate-x-[calc(100%+0.75rem)] place-items-center rounded-sm border bg-background/95 text-muted-foreground opacity-0 shadow-sm ring-1 ring-foreground/5 transition-[opacity,background-color,color] duration-150 hover:bg-muted hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
        title="Hide this reflow element"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          hideWithAnimation();
        }}
        onMouseMove={(event) => event.stopPropagation()}
      >
        <EyeOff size={13} aria-hidden="true" />
      </button>
      <div className="min-w-0">
        <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline">
            {segmentDisplayLabel(segmentGroup.body)}
          </Badge>
          <span>第 {segmentGroup.body.page_idx + 1} 页</span>
          {hasNote ? (
            <Badge className="gap-1 bg-primary/10 text-primary hover:bg-primary/10">
              <StickyNote size={11} />
              Note
            </Badge>
          ) : null}
          {annotationCount > 0 ? (
            <Badge className="gap-1 bg-warning-surface text-warning hover:bg-warning-surface">
              <MessageCircle size={11} />
              Annotation {annotationCount}
            </Badge>
          ) : null}
          {sourceLinkCount > 0 ? (
            <Badge className="gap-1 bg-success-surface text-success hover:bg-success-surface">
              <Link2 size={11} />
              Reference {sourceLinkCount}
            </Badge>
          ) : null}
          <MineruMetadataBadges segment={segmentGroup.body} />
        </div>

        {segmentGroup.kind === "visual" ? (
          <VisualReflowContent
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
          />
        ) : (
          <TextReflowContent
            entryId={entryId}
            hoverPreviewEnabled={hoverPreviewEnabled}
            onPreviewChange={onPreviewChange}
            pdfDocument={pdfDocument}
            reflowTranslationMode={reflowTranslationMode}
            relatedImagePath={relatedImagePath}
            segment={segmentGroup.body}
            translatedText={
              translationBySegmentUid.get(segmentGroup.body.uid)
                ?.translated_text ?? null
            }
            workspaceRoot={workspaceRoot}
          />
        )}
      </div>
      {menuPosition ? (
        <SegmentActionMenu
          canAddSourceLink={Boolean(onAddSourceLink)}
          canCopyContent={true}
          canCopySourceLink={true}
          position={menuPosition}
          segment={segmentGroup.body}
          sourceBacklinks={
            sourceBacklinksBySegmentUid[segmentGroup.body.uid] ??
            sourceBacklinksBySegmentUid[logicalSegmentUid(segmentGroup.body)] ??
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
          onHideSegment={onHideSegment}
          onOpenSourceBacklink={onOpenSourceBacklink}
        />
      ) : null}
    </section>
  );
});

function VisualReflowContent({
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
}: {
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
}) {
  const bodyText = segmentGroup.body.markdown ?? segmentGroup.body.text;

  return (
    <div className="grid min-w-0 gap-3">
      <SegmentText
        entryId={entryId}
        originalText={bodyText || segmentGroup.body.text}
        reflowTranslationMode={reflowTranslationMode}
        relatedImagePath={relatedImagePath}
        segment={segmentGroup.body}
        translatedText={
          translationBySegmentUid.get(segmentGroup.body.uid)?.translated_text ??
          null
        }
        workspaceRoot={workspaceRoot}
      />

      {segmentGroup.captions.map((caption) => (
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
      ))}

      {segmentGroup.footnotes.map((footnote) => (
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
      ))}
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
      <div className="min-w-0 text-[15px] leading-relaxed text-foreground">
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
      <div className="min-w-0 text-[13px] leading-normal">
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
      <div className="min-w-0 text-[15px] leading-relaxed">
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
      <div className="min-w-0 border-l-2 border-muted-foreground/25 pl-3 text-sm text-muted-foreground">
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
    level <= 1 && "text-2xl",
    level === 2 && "text-xl",
    level === 3 && "text-lg",
    level >= 4 && "text-base",
  );
}

type ReflowListItem = {
  copyText: string;
  index: number;
  markdown: string;
};

function ensureListMarkdown(text: string, segment: SourceSegment) {
  const trimmed = text.trim();
  if (/^(?:[-*+] |\d+[.)] )/m.test(trimmed)) {
    return trimmed;
  }

  const ordered = isOrderedListSegment(segment);
  return trimmed
    .split(/\r?\n/)
    .map((line, index) => line.trim())
    .filter(Boolean)
    .map((line, index) => `${ordered ? `${index + 1}.` : "-"} ${line}`)
    .join("\n");
}

function parseMarkdownListItems(markdown: string): ReflowListItem[] {
  const items: ReflowListItem[] = [];
  const lines = markdown.trim().split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*(?:([-*+])|(\d+[.)]))\s+(.*)$/);
    if (match) {
      const index = items.length;
      items.push({
        copyText: plainTextFromMarkdown(match[3]),
        index,
        markdown: match[3],
      });
      continue;
    }

    const continuation = line.trim();
    const current = items[items.length - 1];
    if (continuation && current) {
      current.markdown = `${current.markdown}\n${continuation}`;
      current.copyText = plainTextFromMarkdown(current.markdown);
    }
  }

  return items;
}

function plainTextFromMarkdown(markdown: string) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function isOrderedListSegment(segment: SourceSegment) {
  const metadata = segment.mineru_metadata ?? {};
  const raw = [metadata.list_type, segment.sub_type, metadata.sub_type, segment.raw_type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    raw.includes("ordered") ||
    raw.includes("number") ||
    raw.includes("decimal") ||
    raw.includes("ref_text") ||
    raw.includes("index")
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
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-sm border-l-2 px-3 py-2",
        subtle
          ? "bg-muted/30 text-xs text-muted-foreground"
          : "bg-muted/40 text-sm",
      )}
      onMouseMove={(event) => {
        event.stopPropagation();
        if (!hoverPreviewEnabled) {
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
      <SegmentText
        entryId={entryId}
        originalText={segment.markdown ?? segment.text}
        reflowTranslationMode={reflowTranslationMode}
        relatedImagePath={relatedImagePath}
        segment={segment}
        translatedText={translatedText}
        workspaceRoot={workspaceRoot}
      />
    </div>
  );
}

function InteractiveListContent({
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
  relatedImagePath?: string | null;
  segment: SourceSegment;
  translatedText: string | null;
  workspaceRoot: string | null;
}) {
  const originalText = ensureListMarkdown(segment.markdown ?? segment.text, segment);
  const translatedListText = translatedText?.trim()
    ? ensureListMarkdown(translatedText, segment)
    : null;

  if (reflowTranslationMode === "translation") {
    return (
      <InteractiveListItems
        copyPrefix="translation"
        entryId={entryId}
        hoverPreviewEnabled={hoverPreviewEnabled}
        hoverMarkdown={originalText}
        markdown={translatedListText ?? originalText}
        onPreviewChange={onPreviewChange}
        pdfDocument={pdfDocument}
        relatedImagePath={relatedImagePath}
        segment={segment}
        workspaceRoot={workspaceRoot}
      />
    );
  }

  if (reflowTranslationMode === "bilingual" && translatedListText) {
    return (
      <div className="grid min-w-0 gap-2">
        <InteractiveListItems
          copyPrefix="source"
          entryId={entryId}
          hoverPreviewEnabled={hoverPreviewEnabled}
          hoverMarkdown={originalText}
          markdown={originalText}
          onPreviewChange={onPreviewChange}
          pdfDocument={pdfDocument}
          relatedImagePath={relatedImagePath}
          segment={segment}
          workspaceRoot={workspaceRoot}
        />
        <div className="min-w-0 border-t pt-2 text-[0.95em] text-muted-foreground">
          <InteractiveListItems
            copyPrefix="translation"
            entryId={entryId}
            hoverPreviewEnabled={hoverPreviewEnabled}
            hoverMarkdown={originalText}
            markdown={translatedListText}
            onPreviewChange={onPreviewChange}
            pdfDocument={pdfDocument}
            segment={segment}
            workspaceRoot={workspaceRoot}
          />
        </div>
      </div>
    );
  }

  return (
    <InteractiveListItems
      copyPrefix="source"
      entryId={entryId}
      hoverPreviewEnabled={hoverPreviewEnabled}
      hoverMarkdown={originalText}
      markdown={originalText}
      onPreviewChange={onPreviewChange}
      pdfDocument={pdfDocument}
      relatedImagePath={relatedImagePath}
      segment={segment}
      workspaceRoot={workspaceRoot}
    />
  );
}

function InteractiveListItems({
  copyPrefix,
  entryId,
  hoverPreviewEnabled,
  hoverMarkdown,
  markdown,
  onPreviewChange,
  pdfDocument,
  relatedImagePath,
  segment,
  workspaceRoot,
}: {
  copyPrefix: string;
  entryId: string;
  hoverPreviewEnabled: boolean;
  hoverMarkdown: string;
  markdown: string;
  onPreviewChange: (next: ReflowPreviewPointerState | null) => void;
  pdfDocument: PDFDocumentProxy | null;
  relatedImagePath?: string | null;
  segment: SourceSegment;
  workspaceRoot: string | null;
}) {
  const { notify } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const items = useMemo(() => parseMarkdownListItems(markdown), [markdown]);
  const hoverItems = useMemo(() => parseMarkdownListItems(hoverMarkdown), [hoverMarkdown]);

  if (items.length === 0) {
    return (
      <SegmentText
        entryId={entryId}
        originalText={markdown}
        reflowTranslationMode="source"
        relatedImagePath={relatedImagePath}
        segment={segment}
        translatedText={null}
        workspaceRoot={workspaceRoot}
      />
    );
  }

  const copyItem = async (item: ReflowListItem) => {
    try {
      await navigator.clipboard.writeText(item.copyText);
      const key = `${copyPrefix}:${item.index}`;
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1200);
      notify({ title: "列表项已复制", tone: "success", durationMs: 1400 });
    } catch {
      notify({ title: "复制列表项失败", tone: "danger", durationMs: 1800 });
    }
  };

  return (
    <div className="grid min-w-0 gap-1" role="list">
      {items.map((item) => {
        const key = `${copyPrefix}:${item.index}`;
        const copied = copiedKey === key;
        return (
          <div
            className="group/list-item grid min-w-0 cursor-copy grid-cols-[minmax(0,1fr)_1.75rem] items-start gap-2 rounded-sm px-2 py-1.5 transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            key={key}
            role="listitem"
            tabIndex={0}
            data-reflow-list-item
            onMouseMove={(event) => {
              event.stopPropagation();
              if (!hoverPreviewEnabled) {
                onPreviewChange(null);
                return;
              }
              const previewSegment = listItemPreviewSegment(segment, hoverItems[item.index] ?? item);
              warmReflowPreviewAssets({
                entryId,
                markdown: previewSegment.markdown ?? previewSegment.text,
                pdfDocument,
                relatedImagePath,
                segment: previewSegment,
                workspaceRoot,
              });
              onPreviewChange({
                position: { x: event.clientX, y: event.clientY },
                relatedImagePath,
                segment: previewSegment,
              });
            }}
            title="复制这一项"
            onClick={(event) => {
              event.stopPropagation();
              void copyItem(item);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                void copyItem(item);
              }
            }}
          >
            <div className="min-w-0">
              <SourceSnapshotPreview
                allowScroll={false}
                flush
                markdown={item.markdown}
                relatedImagePath={relatedImagePath}
                segmentType={segment.segment_type}
                sourceEntryId={entryId || null}
                workspaceRoot={workspaceRoot}
              />
            </div>
            <span className="grid size-6 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover/list-item:opacity-100 group-focus-within/list-item:opacity-100">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function listItemPreviewSegment(segment: SourceSegment, item: ReflowListItem): SourceSegment {
  return {
    ...segment,
    bbox: null,
    markdown: item.markdown,
    text: item.copyText,
    uid: `${segment.uid}:list-item:${item.index}`,
  };
}

function SegmentText({
  entryId,
  originalText,
  reflowTranslationMode,
  relatedImagePath,
  segment,
  translatedText,
  workspaceRoot,
}: {
  entryId: string;
  originalText: string;
  reflowTranslationMode: ReflowTranslationMode;
  relatedImagePath?: string | null;
  segment: SourceSegment;
  translatedText: string | null;
  workspaceRoot: string | null;
}) {
  if (reflowTranslationMode === "translation") {
    return (
      <SourceSnapshotPreview
        allowScroll={false}
        markdown={translatedText?.trim() || originalText}
        relatedImagePath={relatedImagePath}
        segmentType={segment.segment_type}
        sourceEntryId={entryId || null}
        workspaceRoot={workspaceRoot}
      />
    );
  }

  if (reflowTranslationMode === "bilingual" && translatedText?.trim()) {
    return (
      <div className="grid min-w-0 gap-2">
        <SourceSnapshotPreview
          allowScroll={false}
          markdown={originalText}
          relatedImagePath={relatedImagePath}
          segmentType={segment.segment_type}
          sourceEntryId={entryId || null}
          workspaceRoot={workspaceRoot}
        />
        <div className="min-w-0 border-t pt-2 text-[0.95em] text-muted-foreground">
          <SourceSnapshotPreview
            allowScroll={false}
            markdown={translatedText}
            segmentType={segment.segment_type}
            sourceEntryId={entryId || null}
            workspaceRoot={workspaceRoot}
          />
        </div>
      </div>
    );
  }

  return (
    <SourceSnapshotPreview
      allowScroll={false}
      markdown={originalText}
      relatedImagePath={relatedImagePath}
      segmentType={segment.segment_type}
      sourceEntryId={entryId || null}
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
