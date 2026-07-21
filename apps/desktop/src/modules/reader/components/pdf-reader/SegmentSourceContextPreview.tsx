import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  SourceSnapshotPreview,
  isMineruImagePath,
  resolveMineruAssetUrl
} from '@/shared/components/SourceSnapshotPreview';
import type { AnnotationTextSelection, SourceSegment } from '@/shared/types/domain';

import { readCachedPdfSegmentSnapshot } from '../reflow/pdfSourceSnapshot';
import { useStoredCollapseState } from './useStoredCollapseState';

export function SegmentSourceContextPreview({
  defaultExpanded = false,
  embeddedOriginal = false,
  highlightSelections = [],
  pdfDocument,
  segment,
  sourceEntryId,
  workspaceRoot
}: {
  defaultExpanded?: boolean;
  embeddedOriginal?: boolean;
  highlightSelections?: AnnotationTextSelection[];
  pdfDocument?: PDFDocumentProxy | null;
  segment: SourceSegment;
  sourceEntryId: string;
  workspaceRoot: string | null;
}) {
  const { collapsed, toggleCollapsed } = useStoredCollapseState(
    defaultExpanded ? 'recordSourceCollapsed' : 'sourceCollapsed',
    !defaultExpanded
  );
  const [mode, setMode] = useState<'parsed' | 'original'>('original');
  const [pdfFallbackUrl, setPdfFallbackUrl] = useState<string | null>(null);
  const [pdfFallbackLoading, setPdfFallbackLoading] = useState(false);
  const [originalPreviewOpen, setOriginalPreviewOpen] = useState(false);
  const markdown = segment.markdown?.trim() || segment.text.trim();
  const originalImagePath = useMemo(() => {
    if (segment.asset_path) {
      return segment.asset_path;
    }
    if (isMineruImagePath(markdown)) {
      return markdown;
    }
    return null;
  }, [markdown, segment.asset_path]);
  const originalImageUrl = originalImagePath
    ? resolveMineruAssetUrl(originalImagePath, workspaceRoot, sourceEntryId)
    : null;
  const localOriginalUrl = pdfFallbackUrl ?? originalImageUrl;
  const originalPreviewIsPdf = Boolean(pdfFallbackUrl);
  const displayMode = embeddedOriginal ? 'original' : mode;
  const originalHighlights = useMemo(
    () => buildPdfOriginalHighlights(segment, highlightSelections),
    [highlightSelections, segment]
  );

  useEffect(() => {
    let cancelled = false;

    setPdfFallbackUrl(null);
    if (displayMode !== 'original' || !pdfDocument) {
      setPdfFallbackLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setPdfFallbackLoading(true);
    readCachedPdfSegmentSnapshot(pdfDocument, segment)
      .then((nextUrl) => {
        if (!cancelled) {
          setPdfFallbackUrl(nextUrl);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPdfFallbackLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [displayMode, pdfDocument, segment, originalImageUrl]);

  const sourceContent = displayMode === 'parsed' ? (
    highlightSelections.length > 0 ? (
      <HighlightedSegmentText
        selections={highlightSelections}
        text={segment.text.trim() || markdown || '暂无解析内容'}
      />
    ) : (
      <SourceSnapshotPreview
        allowScroll={!embeddedOriginal}
        compact
        markdown={markdown || '暂无解析内容'}
        relatedImagePath={originalImagePath}
        segmentType={segment.segment_type}
        sourceEntryId={sourceEntryId}
        workspaceRoot={workspaceRoot}
      />
    )
  ) : localOriginalUrl ? (
    <div className="grid gap-1.5">
      {!embeddedOriginal ? (
        <div className="flex items-center justify-between px-0.5 text-[11px] text-muted-foreground">
          <span>{originalPreviewIsPdf ? 'PDF 原文' : '原始版面'}</span>
          {highlightSelections.length > 0 ? <span>已叠加高亮位置</span> : null}
        </div>
      ) : null}
      {embeddedOriginal ? (
        <div className="flex w-full justify-center overflow-hidden rounded-md border bg-white p-1">
          <PdfOriginalImage
            alt="Segment PDF original"
            className="max-h-56"
            highlights={originalPreviewIsPdf ? originalHighlights : []}
            src={localOriginalUrl}
          />
        </div>
      ) : (
        <button
          className="flex w-full cursor-zoom-in justify-center overflow-hidden rounded-md border bg-white p-1 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          title="单击查看完整 PDF 原文"
          type="button"
          onClick={() => setOriginalPreviewOpen(true)}
        >
          <PdfOriginalImage
            alt="Segment PDF original"
            className="max-h-56"
            highlights={originalPreviewIsPdf ? originalHighlights : []}
            src={localOriginalUrl}
          />
        </button>
      )}
    </div>
  ) : (
    <div className="rounded-md border border-dashed bg-white px-3 py-6 text-center text-muted-foreground">
      {pdfFallbackLoading
        ? '正在从本地 PDF 读取原图...'
        : '暂无可用原图。当前片段仍可查看解析后的原文内容。'}
    </div>
  );

  if (embeddedOriginal) {
    return <div className="min-w-0 text-xs leading-5">{sourceContent}</div>;
  }

  return (
    <section className="grid min-w-0 gap-2 rounded-md border bg-white px-3 py-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <Button
            className="-ml-1 mt-0.5 shrink-0"
            size="icon-xs"
            title={collapsed ? '展开原文' : '折叠原文'}
            type="button"
            variant="ghost"
            onClick={toggleCollapsed}
          >
            {collapsed ? (
              <ChevronRight size={13} aria-hidden="true" />
            ) : (
              <ChevronDown size={13} aria-hidden="true" />
            )}
          </Button>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">原文</div>
            {!collapsed ? (
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                默认显示 PDF 原文；可切换查看解析文本。
              </div>
            ) : null}
          </div>
        </div>
        {!collapsed ? (
          <div className="flex shrink-0 items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
            <span className={mode === 'parsed' ? 'text-xs font-semibold text-foreground' : 'text-xs text-muted-foreground'}>
              解析
            </span>
            <Switch
              checked={mode === 'original'}
              aria-label="切换解析文本和 PDF 原文"
              onCheckedChange={(checked) => setMode(checked ? 'original' : 'parsed')}
            />
            <span className={mode === 'original' ? 'text-xs font-semibold text-foreground' : 'text-xs text-muted-foreground'}>
              PDF 原文
            </span>
          </div>
        ) : null}
      </div>

      {!collapsed ? (
      <div className="max-h-48 min-w-0 overflow-auto overscroll-contain rounded-md bg-muted/30 px-2.5 py-2 text-xs leading-5">
        {sourceContent}
      </div>
      ) : null}
      <Dialog open={originalPreviewOpen} onOpenChange={setOriginalPreviewOpen}>
        <DialogContent className="flex max-h-[94vh] max-w-[min(96vw,1200px)] flex-col gap-3 p-4">
          <DialogHeader>
            <DialogTitle>{originalPreviewIsPdf ? 'PDF 原文' : '原始版面'}</DialogTitle>
          </DialogHeader>
          {localOriginalUrl ? (
            <PdfOriginalImage
              alt="Segment PDF original"
              className="max-h-[78vh]"
              highlights={originalPreviewIsPdf ? originalHighlights : []}
              src={localOriginalUrl}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

type PdfOriginalHighlight = {
  color: AnnotationTextSelection['color'];
  height: number;
  left: number;
  top: number;
  width: number;
};

function PdfOriginalImage({
  alt,
  className,
  highlights,
  src
}: {
  alt: string;
  className?: string;
  highlights: PdfOriginalHighlight[];
  src: string;
}) {
  return (
    <span className="relative inline-block max-w-full">
      <img
        alt={alt}
        className={`mx-auto block max-w-full rounded-sm object-contain ${className ?? ''}`}
        src={src}
      />
      {highlights.map((highlight, index) => (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute rounded-[2px] ring-1 ${pdfHighlightColorClass(highlight.color)}`}
          data-pdf-original-highlight="true"
          key={`${highlight.left}:${highlight.top}:${highlight.width}:${highlight.height}:${index}`}
          style={{
            height: `${highlight.height}%`,
            left: `${highlight.left}%`,
            top: `${highlight.top}%`,
            width: `${highlight.width}%`
          }}
        />
      ))}
    </span>
  );
}

function buildPdfOriginalHighlights(
  segment: SourceSegment,
  selections: AnnotationTextSelection[]
): PdfOriginalHighlight[] {
  if (!segment.bbox) return [];
  const [rawX0, rawY0, rawX1, rawY1] = segment.bbox;
  const x0 = Math.min(rawX0, rawX1);
  const y0 = Math.min(rawY0, rawY1);
  const x1 = Math.max(rawX0, rawX1);
  const y1 = Math.max(rawY0, rawY1);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return [];

  return selections
    .filter((selection) => selection.page_idx === segment.page_idx)
    .flatMap((selection) => selection.rects.map(([rawLeft, rawTop, rawRight, rawBottom]) => {
      const left = Math.max(x0, Math.min(rawLeft, rawRight));
      const top = Math.max(y0, Math.min(rawTop, rawBottom));
      const right = Math.min(x1, Math.max(rawLeft, rawRight));
      const bottom = Math.min(y1, Math.max(rawTop, rawBottom));
      if (right <= left || bottom <= top) return null;
      return {
        color: selection.color,
        height: ((bottom - top) / height) * 100,
        left: ((left - x0) / width) * 100,
        top: ((top - y0) / height) * 100,
        width: ((right - left) / width) * 100
      };
    }))
    .filter((highlight): highlight is PdfOriginalHighlight => Boolean(highlight));
}

function HighlightedSegmentText({
  selections,
  text
}: {
  selections: AnnotationTextSelection[];
  text: string;
}) {
  const ranges = selections
    .map((selection) => {
      const selectedText = selection.text.trim();
      const start = selectedText ? text.indexOf(selectedText) : -1;
      return start >= 0
        ? { color: selection.color, end: start + selectedText.length, start }
        : null;
    })
    .filter((range): range is NonNullable<typeof range> => Boolean(range))
    .sort((left, right) => left.start - right.start);

  if (ranges.length === 0) {
    return (
      <div className="whitespace-pre-wrap text-xs leading-5 text-foreground">
        {text}
        {selections.map((selection, index) => (
          <mark
            className={`ml-1 rounded px-0.5 ${highlightColorClass(selection.color)}`}
            key={`${selection.text}:${index}`}
          >
            {selection.text}
          </mark>
        ))}
      </div>
    );
  }

  const content: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start < cursor) return;
    if (range.start > cursor) content.push(text.slice(cursor, range.start));
    content.push(
      <mark
        className={`rounded px-0.5 ${highlightColorClass(range.color)}`}
        key={`${range.start}:${range.end}:${index}`}
      >
        {text.slice(range.start, range.end)}
      </mark>
    );
    cursor = range.end;
  });
  if (cursor < text.length) content.push(text.slice(cursor));

  return <div className="whitespace-pre-wrap text-xs leading-5 text-foreground">{content}</div>;
}

function highlightColorClass(color: AnnotationTextSelection['color']) {
  if (color === 'green') return 'bg-emerald-200/90';
  if (color === 'blue') return 'bg-sky-200/90';
  if (color === 'pink') return 'bg-pink-200/90';
  return 'bg-amber-200/90';
}

function pdfHighlightColorClass(color: AnnotationTextSelection['color']) {
  if (color === 'green') return 'bg-emerald-300/45 ring-emerald-500/55';
  if (color === 'blue') return 'bg-sky-300/45 ring-sky-500/55';
  if (color === 'pink') return 'bg-pink-300/45 ring-pink-500/55';
  return 'bg-amber-300/45 ring-amber-500/55';
}
