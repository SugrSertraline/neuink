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


export function ReflowSourcePreview({
  annotations,
  initialPosition,
  noteText,
  onMoveReady,
  pdfDocument,
  relatedImagePath,
  segment,
  showAnnotation,
  showNote,
  showOriginal,
  showTranslation,
  sourceEntryId,
  translatedText,
  workspaceRoot,
}: {
  annotations: Annotation[];
  initialPosition: ReflowPreviewPosition;
  noteText: string | null;
  onMoveReady: (move: (position: ReflowPreviewPosition) => void) => void;
  pdfDocument: PDFDocumentProxy | null;
  relatedImagePath?: string | null;
  segment: SourceSegment;
  showAnnotation: boolean;
  showNote: boolean;
  showOriginal: boolean;
  showTranslation: boolean;
  sourceEntryId: string;
  translatedText: string | null;
  workspaceRoot: string | null;
}) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const latestPositionRef = useRef(initialPosition);

  useEffect(() => {
    latestPositionRef.current = initialPosition;
    movePreviewElement(previewRef.current, initialPosition);
  }, [initialPosition]);

  useEffect(() => {
    const move = (position: ReflowPreviewPosition) => {
      latestPositionRef.current = position;
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        movePreviewElement(previewRef.current, latestPositionRef.current);
      });
    };
    onMoveReady(move);
    return () => {
      onMoveReady(() => undefined);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [onMoveReady]);

  if (typeof document === "undefined") {
    return null;
  }

  const showNotePreview = showNote && Boolean(noteText?.trim());
  const showAnnotationPreview = showAnnotation && annotations.length > 0;
  const showTranslationPreview = showTranslation && Boolean(translatedText?.trim());
  if (!showOriginal && !showNotePreview && !showAnnotationPreview && !showTranslationPreview) {
    return null;
  }

  const layout = previewLayout(initialPosition);
  return createPortal(
    <div
      ref={previewRef}
      className="pointer-events-none fixed z-[var(--z-reader-preview)] max-h-[80vh] overflow-auto rounded-md border bg-popover text-popover-foreground shadow-xl ring-1 ring-foreground/10"
      style={{
        left: layout.left,
        top: layout.top,
        width: layout.width,
      }}
    >
      <div className="sticky top-0 z-[1] flex items-center gap-2 border-b bg-popover px-2 py-1.5 text-xs">
        <Badge variant="secondary">{segmentDisplayLabel(segment)}</Badge>
        <span className="font-semibold">第 {segment.page_idx + 1} 页</span>
        <span className="text-muted-foreground">片段</span>
      </div>
      <div className="grid min-w-0 gap-3 bg-white p-2 text-muted-foreground">
        {showOriginal ? (
          <PreviewSection label="解析后原文">
            <ReflowSourcePreviewContent
              relatedImagePath={relatedImagePath}
              segment={segment}
              pdfDocument={pdfDocument}
              sourceEntryId={sourceEntryId}
              workspaceRoot={workspaceRoot}
            />
          </PreviewSection>
        ) : null}
        {showTranslationPreview && translatedText ? (
          <PreviewSection label="译文">
            <SourceSnapshotPreview
              allowScroll
              compact
              markdown={translatedText}
              segmentType={segment.segment_type}
              sourceEntryId={sourceEntryId}
              workspaceRoot={workspaceRoot}
            />
          </PreviewSection>
        ) : null}
        {showNotePreview && noteText ? (
          <PreviewSection label="片段笔记">
            <SourceSnapshotPreview
              allowScroll
              compact
              markdown={noteText}
              segmentType="paragraph"
              sourceEntryId={sourceEntryId}
              workspaceRoot={workspaceRoot}
            />
          </PreviewSection>
        ) : null}
        {showAnnotationPreview ? (
          <PreviewSection label="批注">
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
          </PreviewSection>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function PreviewSection({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{label}</div>
      {children}
    </section>
  );
}

const ReflowSourcePreviewContent = memo(function ReflowSourcePreviewContent({
  relatedImagePath,
  segment,
  pdfDocument,
  sourceEntryId,
  workspaceRoot,
}: {
  relatedImagePath?: string | null;
  segment: SourceSegment;
  pdfDocument: PDFDocumentProxy | null;
  sourceEntryId: string;
  workspaceRoot: string | null;
}) {
  const [snapshotState, setSnapshotState] = useState<{
    status: "idle" | "loading" | "ready" | "failed";
    url: string | null;
  }>({ status: "idle", url: null });

  useEffect(() => {
    let cancelled = false;
    if (!pdfDocument || !segment.bbox) {
      setSnapshotState({ status: "idle", url: null });
      return () => {
        cancelled = true;
      };
    }

    setSnapshotState({ status: "loading", url: null });
    void readCachedPdfSegmentSnapshot(pdfDocument, segment).then((url) => {
      if (cancelled) {
        return;
      }
      setSnapshotState(
        url ? { status: "ready", url } : { status: "failed", url: null },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, segment]);

  if (snapshotState.status === "ready" && snapshotState.url) {
    return (
      <img
        alt="PDF source snapshot"
        className="block max-h-[70vh] max-w-full rounded-sm border bg-white object-contain"
        src={snapshotState.url}
      />
    );
  }

  if (snapshotState.status === "loading") {
    return (
      <div className="flex min-h-24 items-center justify-center rounded-sm border bg-white px-3 py-4 text-xs text-muted-foreground">
        婵繐绲藉﹢顏堝箣椤忓嫬绲?PDF 闁告鍠庨～鎰板锤?..
      </div>
    );
  }

  return (
    <SourceSnapshotPreview
      allowScroll
      compact
      markdown={segment.markdown ?? segment.text}
      relatedImagePath={relatedImagePath}
      segmentType={segment.segment_type}
      sourceEntryId={sourceEntryId}
      workspaceRoot={workspaceRoot}
    />
  );
});

function movePreviewElement(
  element: HTMLDivElement | null,
  position: ReflowPreviewPosition,
) {
  if (!element) {
    return;
  }
  const layout = previewLayout(position);
  element.style.left = `${layout.left}px`;
  element.style.top = `${layout.top}px`;
  element.style.width = `${layout.width}px`;
}

function previewLayout(position: { x: number; y: number }) {
  const viewportWidth =
    typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight =
    typeof window === "undefined" ? 768 : window.innerHeight;
  const margin = 12;
  const width = Math.max(160, Math.min(720, viewportWidth - margin * 2));
  const left =
    position.x + margin + width > viewportWidth
      ? Math.max(margin, position.x - width - margin)
      : position.x + margin;
  const top =
    position.y + margin + 420 > viewportHeight
      ? Math.max(margin, viewportHeight - 420 - margin)
      : position.y + margin;

  return { left, top, width };
}

const warmedPreviewAssetUrls = new Set<string>();
const warmedPreviewSegmentKeys = new Set<string>();
const MAX_WARMED_PREVIEW_ASSETS = 128;
const MAX_WARMED_PREVIEW_SEGMENTS = 128;

export function warmReflowPreviewAssets({
  entryId,
  markdown,
  pdfDocument,
  relatedImagePath,
  segment,
  workspaceRoot,
}: {
  entryId: string;
  markdown: string;
  pdfDocument: PDFDocumentProxy | null;
  relatedImagePath?: string | null;
  segment: SourceSegment;
  workspaceRoot: string | null;
}) {
  if (typeof window === "undefined") {
    return;
  }

  const cacheKey = `${entryId}:${segment.uid}:${pdfDocument ? "pdf" : "content"}`;
  if (warmedPreviewSegmentKeys.has(cacheKey)) {
    return;
  }
  warmedPreviewSegmentKeys.add(cacheKey);
  trimStringSet(warmedPreviewSegmentKeys, MAX_WARMED_PREVIEW_SEGMENTS);

  warmCachedPdfSegmentSnapshot(pdfDocument, segment);

  const urls = [
    relatedImagePath
      ? resolveMineruAssetUrl(relatedImagePath, workspaceRoot, entryId)
      : null,
    resolveMineruAssetUrl(markdown, workspaceRoot, entryId),
    ...extractMarkdownImageUrls(markdown, workspaceRoot, entryId),
  ].filter((url): url is string => Boolean(url));

  for (const url of urls) {
    if (warmedPreviewAssetUrls.has(url)) {
      continue;
    }
    warmedPreviewAssetUrls.add(url);
    trimStringSet(warmedPreviewAssetUrls, MAX_WARMED_PREVIEW_ASSETS);
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  }
}

function trimStringSet(values: Set<string>, limit: number) {
  while (values.size > limit) {
    const oldest = values.values().next().value;
    if (typeof oldest !== 'string') return;
    values.delete(oldest);
  }
}

function extractMarkdownImageUrls(
  markdown: string,
  workspaceRoot: string | null,
  entryId: string,
) {
  const urls: string[] = [];
  const imagePattern = /!\[[^\]]*]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = imagePattern.exec(markdown)) !== null) {
    const resolved = resolveMineruAssetUrl(match[1], workspaceRoot, entryId);
    if (resolved) {
      urls.push(resolved);
    }
  }
  return urls;
}

export type ReflowPreviewPosition = { x: number; y: number };

export type ReflowPreviewState = {
  initialPosition: ReflowPreviewPosition;
  relatedImagePath?: string | null;
  segment: SourceSegment;
};

export type ReflowPreviewPointerState = {
  position: ReflowPreviewPosition;
  relatedImagePath?: string | null;
  segment: SourceSegment;
};

export function previewStateForPointer(
  current: ReflowPreviewState | null,
  next: ReflowPreviewPointerState,
) {
  if (!current || current.segment.uid !== next.segment.uid) {
    return {
      initialPosition: next.position,
      relatedImagePath: next.relatedImagePath,
      segment: next.segment,
    };
  }
  return current;
}
