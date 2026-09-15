import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { Badge } from "@/components/ui/badge";
import { PointerPreview, type PreviewAnchor } from '@/components/ui/pointer-preview';
import { useReaderPreviewVisible } from '@/components/ui/hover-interactions';
import {
  resolveMineruAssetUrl,
  SourceSnapshotPreview,
} from "@/shared/components/SourceSnapshotPreview";
import type { Annotation, SourceSegment } from "@/shared/types/domain";

import {
  segmentDisplayLabel,
} from "../pdf-reader/readerUtils";
import {
  readCachedPdfSegmentSnapshot,
  warmCachedPdfSegmentSnapshot,
} from "./pdfSourceSnapshot";

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
  const visible = useReaderPreviewVisible(segment.uid);
  const positionRef = useRef(initialPosition);
  const moveRef = useRef<(anchor: PreviewAnchor) => void>(() => {});
  useEffect(() => { positionRef.current = initialPosition; }, [initialPosition]);
  useEffect(() => {
    onMoveReady((position) => {
      positionRef.current = position;
      moveRef.current({ x: position.x, top: position.y, bottom: position.y });
    });
    return () => onMoveReady(() => {});
  }, [onMoveReady]);
  const registerMove = useCallback((move: (anchor: PreviewAnchor) => void) => { moveRef.current = move; }, []);

  if (!visible || typeof document === "undefined") {
    return null;
  }

  const showNotePreview = showNote && Boolean(noteText?.trim());
  const showAnnotationPreview = showAnnotation && annotations.length > 0;
  const showTranslationPreview = showTranslation && Boolean(translatedText?.trim());
  if (!showOriginal && !showNotePreview && !showAnnotationPreview && !showTranslationPreview) {
    return null;
  }

  return (
    <PointerPreview
      anchor={{ x: positionRef.current.x, top: positionRef.current.y, bottom: positionRef.current.y }}
      width={720}
      onMoveReady={registerMove}
    >
      <div className="sticky top-0 z-[1] flex items-center gap-2 border-b bg-popover px-2 py-1.5 text-xs">
        <Badge variant="secondary">{segmentDisplayLabel(segment)}</Badge>
        <span className="font-semibold">第 {segment.page_idx + 1} 页</span>
        <span className="text-muted-foreground">片段</span>
      </div>
      <div className="grid min-w-0 gap-3 p-3 text-muted-foreground">
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
    </PointerPreview>
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
        正在生成 PDF 快照...
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
