import { NodeViewWrapper } from '@tiptap/react';
import { AlignCenter, AlignLeft, AlignRight, ArrowUpRight, Check, ChevronRight, ClipboardCopy, ImageIcon, Link2, PanelTopClose, Rows3, Settings2, Trash2 } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { createPdfDocumentOptions } from '@/modules/reader/components/pdf-reader/pdfDocumentOptions';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { readPdfBytes, readPdfReader, saveNoteAssetBytes } from '@/shared/ipc/workspaceApi';
import { UI_TERMS } from '@/shared/lib/uiTerminology';
import type { SegmentType, SourceSegment } from '@/shared/types/domain';
import { readCachedPdfSegmentSnapshot } from '@/modules/reader/components/reflow/pdfSourceSnapshot';

import type { SourceLinkOpenTarget, SourceLinkSnapshotAssetContext } from './SourceLinkNode';

type SourceLinkNodeAttrs = {
  anchorId?: string | null;
  displayText?: string | null;
  expanded?: boolean | null;
  page?: number | null;
  previewAlignment?: SourceLinkPreviewAlignment | null;
  previewMode?: SourceLinkPreviewMode | null;
  previewWidth?: number | null;
  sourceBbox?: [number, number, number, number] | null;
  segmentUid?: string | null;
  sourceEntryId?: string | null;
  segmentType?: SegmentType | null;
  snapshotAssetPath?: string | null;
  snapshotText?: string | null;
  workspaceRoot?: string | null;
};

type SourceLinkPreviewMode = 'parsed' | 'original';
type SourceLinkPreviewAlignment = 'left' | 'center' | 'right';

type PersistedSourceLinkState = {
  expanded?: boolean;
  previewAlignment?: SourceLinkPreviewAlignment;
  previewFontSize?: number;
  previewMode?: SourceLinkPreviewMode;
  previewWidth?: number;
};

export function SourceLinkNodeView({
  deleteNode,
  node,
  getPdfDocument,
  updateAttributes,
  snapshotAssetContext,
  onOpenSourceLink
}: {
  deleteNode?: () => void;
  node: { attrs: SourceLinkNodeAttrs };
  getPdfDocument?: (() => PDFDocumentProxy | null) | null;
  updateAttributes?: (attrs: Partial<SourceLinkNodeAttrs>) => void;
  snapshotAssetContext?: SourceLinkSnapshotAssetContext | null;
  onOpenSourceLink?: ((target: SourceLinkOpenTarget) => void) | null;
}) {
  const [copied, setCopied] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const skipClickRef = useRef(false);
  const wrapperRef = useRef<HTMLElement | null>(null);
  const anchorId = node.attrs.anchorId ?? '';
  const persistedState = useMemo(() => readPersistedSourceLinkState(anchorId), [anchorId]);
  const [expanded, setExpanded] = useState(
    persistedState.expanded ?? Boolean(node.attrs.expanded)
  );
  const [previewMode, setPreviewMode] = useState<SourceLinkPreviewMode>(
    persistedState.previewMode ?? normalizePreviewMode(node.attrs.previewMode)
  );
  const [previewAlignment, setPreviewAlignment] = useState<SourceLinkPreviewAlignment>(
    persistedState.previewAlignment ?? normalizePreviewAlignment(node.attrs.previewAlignment)
  );
  const [previewWidth, setPreviewWidth] = useState(
    persistedState.previewWidth ?? normalizePreviewWidth(node.attrs.previewWidth)
  );
  const [previewFontSize, setPreviewFontSize] = useState(
    persistedState.previewFontSize ?? normalizePreviewFontSize(null)
  );
  const label =
    node.attrs.displayText ||
    (node.attrs.page ? `p.${node.attrs.page}` : anchorId.replace(/^sl-/, 'SL '));
  const snapshotText = node.attrs.snapshotText?.trim();
  const codeLanguage = node.attrs.segmentType === 'code'
    ? inferCodeLanguage(snapshotText)
    : null;
  const canOpenSource = Boolean(
    onOpenSourceLink && node.attrs.sourceEntryId && node.attrs.segmentUid
  );
  const sourceMeta = [
    anchorId ? `Anchor ${anchorId}` : null,
    node.attrs.page ? `第 ${node.attrs.page} 页` : null,
    node.attrs.segmentType ? `类型 ${node.attrs.segmentType}` : null,
    codeLanguage ? `语言 ${codeLanguage}` : null,
    canOpenSource ? '可跳转到原文' : null
  ].filter(Boolean) as string[];
  const openSource = () => {
    if (!canOpenSource) {
      return;
    }

    onOpenSourceLink?.({
      page: node.attrs.page ?? null,
      segmentUid: node.attrs.segmentUid ?? null,
      sourceEntryId: node.attrs.sourceEntryId ?? null
    });
  };

  const copyCitation = async () => {
    const citation = buildSourceLinkCitation(node.attrs, label);
    if (!citation) {
      return;
    }

    try {
      await navigator.clipboard?.writeText(citation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const deleteSourceLink = () => {
    setExpandedState(false);
    deleteNode?.();
  };

  const persistState = (state: PersistedSourceLinkState) => {
    if (!anchorId) {
      return;
    }
    writePersistedSourceLinkState(anchorId, {
      expanded,
      previewAlignment,
      previewFontSize,
      previewMode,
      previewWidth,
      ...state
    });
  };

  const setExpandedState = (value: boolean) => {
    setExpanded(value);
    persistState({ expanded: value });
    updateAttributes?.({ expanded: value });
  };

  const setModeState = (value: SourceLinkPreviewMode) => {
    setPreviewMode(value);
    persistState({ previewMode: value });
    updateAttributes?.({ previewMode: value });
  };

  const setAlignmentState = (value: SourceLinkPreviewAlignment) => {
    setPreviewAlignment(value);
    persistState({ previewAlignment: value });
    updateAttributes?.({ previewAlignment: value });
  };

  const setWidthState = (value: number) => {
    const normalized = normalizePreviewWidth(value);
    setPreviewWidth(normalized);
    persistState({ previewWidth: normalized });
    updateAttributes?.({ previewWidth: normalized });
  };

  const setFontSizeState = (value: number) => {
    const normalized = normalizePreviewFontSize(value);
    setPreviewFontSize(normalized);
    persistState({ previewFontSize: normalized });
  };

  useEffect(() => {
    if (!controlsOpen) {
      return;
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) {
        return;
      }
      setControlsOpen(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, [controlsOpen]);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }

    if ((event.ctrlKey || event.metaKey) && canOpenSource) {
      openSource();
      return;
    }

    setExpandedState(!expanded);
  };

  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.ctrlKey || event.metaKey) {
      skipClickRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      openSource();
      return;
    }

    event.preventDefault();
  };

  return (
    <NodeViewWrapper
      as="span"
      ref={wrapperRef}
      className={cn(
        'group/source-link max-w-full flex-wrap items-start gap-1.5 align-baseline',
        expanded ? 'flex w-full' : 'inline-flex'
      )}
      data-source-link="true"
      data-source-link-anchor-id={anchorId}
    >
      {!expanded ? (
        <button
          aria-expanded={expanded}
          className="inline-flex max-w-full items-center gap-1 rounded-sm border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[0.72em] font-semibold leading-none text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          title={
            canOpenSource
              ? 'Click to preview. Ctrl/Cmd+Click jumps to the source.'
              : anchorId || UI_TERMS.sourceLink
          }
          type="button"
          onClick={handleClick}
          onMouseDown={handleMouseDown}
        >
          <ChevronRight size={11} aria-hidden="true" />
          <Link2 size={11} aria-hidden="true" />
          <span className="truncate">{label || 'Source'}</span>
        </button>
      ) : null}

      {expanded ? (
        <span className="w-full basis-full py-1">
          <span
            className={cn(
              'relative block w-full rounded-lg border text-xs leading-5 text-muted-foreground transition-all duration-200 ease-out',
              controlsOpen
                ? 'border-border bg-background/95 p-3 shadow-sm'
                : 'border-transparent bg-transparent p-0 shadow-none'
            )}
          >
            {!controlsOpen ? (
              <span className="pointer-events-none absolute right-1 top-1 z-10 inline-flex items-center gap-1 opacity-0 transition group-hover/source-link:pointer-events-auto group-hover/source-link:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
                <button
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background/95 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  title="收起引用"
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setControlsOpen(false);
                    setExpandedState(false);
                  }}
                  onMouseDown={stopButtonMouseDown}
                >
                  <PanelTopClose size={13} aria-hidden="true" />
                </button>
                <button
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-background/95 text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  title="显示引用工具"
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setControlsOpen(true);
                  }}
                  onMouseDown={stopButtonMouseDown}
                >
                  <Settings2 size={13} aria-hidden="true" />
                </button>
              </span>
            ) : null}

            <span
              className={cn(
                'flex min-w-0 items-start justify-between gap-3 overflow-hidden transition-all duration-200 ease-out',
                controlsOpen ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0'
              )}
            >
              <span className="min-w-0">
                <span className="block font-semibold text-foreground">{UI_TERMS.sourceLink}</span>
                <span className="mt-0.5 block text-[11px]">
                  {previewMode === 'original' ? '显示原始 PDF 截图' : '显示解析后的正文内容'}
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                <button
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted',
                    previewMode === 'parsed' && 'border-primary/40 bg-primary/10 text-primary'
                  )}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setModeState('parsed');
                  }}
                  onMouseDown={stopButtonMouseDown}
                >
                  <Rows3 size={11} aria-hidden="true" />
                  解析
                </button>
                <button
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted disabled:opacity-40',
                    previewMode === 'original' && 'border-primary/40 bg-primary/10 text-primary'
                  )}
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setModeState('original');
                  }}
                  onMouseDown={stopButtonMouseDown}
                >
                  <ImageIcon size={11} aria-hidden="true" />
                  原图
                </button>
                <button
                  className={cn('inline-flex items-center rounded-md border bg-background px-1.5 py-1 transition hover:bg-muted', previewAlignment === 'left' && 'border-primary/40 bg-primary/10 text-primary')}
                  title="左对齐"
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setAlignmentState('left');
                  }}
                  onMouseDown={stopButtonMouseDown}
                >
                  <AlignLeft size={11} aria-hidden="true" />
                </button>
                <button
                  className={cn('inline-flex items-center rounded-md border bg-background px-1.5 py-1 transition hover:bg-muted', previewAlignment === 'center' && 'border-primary/40 bg-primary/10 text-primary')}
                  title="居中"
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setAlignmentState('center');
                  }}
                  onMouseDown={stopButtonMouseDown}
                >
                  <AlignCenter size={11} aria-hidden="true" />
                </button>
                <button
                  className={cn('inline-flex items-center rounded-md border bg-background px-1.5 py-1 transition hover:bg-muted', previewAlignment === 'right' && 'border-primary/40 bg-primary/10 text-primary')}
                  title="右对齐"
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setAlignmentState('right');
                  }}
                  onMouseDown={stopButtonMouseDown}
                >
                  <AlignRight size={11} aria-hidden="true" />
                </button>
                <input
                  aria-label="引用宽度"
                  className="h-6 w-24"
                  max="100"
                  min="24"
                  step="1"
                  type="range"
                  value={previewWidth}
                  onChange={(event) => setWidthState(Number(event.target.value))}
                  onMouseDown={(event) => event.stopPropagation()}
                />
                {previewMode === 'parsed' ? (
                  <label className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-foreground">
                    字号
                    <input
                      aria-label="解析字号"
                      className="h-5 w-20"
                      max="20"
                      min="11"
                      step="1"
                      type="range"
                      value={previewFontSize}
                      onChange={(event) => setFontSizeState(Number(event.target.value))}
                      onMouseDown={(event) => event.stopPropagation()}
                    />
                    <span className="tabular-nums">{previewFontSize}px</span>
                  </label>
                ) : null}
	                {canOpenSource ? (
	                  <button
	                    className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted"
	                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openSource();
	                    }}
                    onMouseDown={stopButtonMouseDown}
	                  >
	                    <ArrowUpRight size={11} aria-hidden="true" />
	                    打开
	                  </button>
	                ) : null}
	                <button
	                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted"
	                  type="button"
	                  onClick={(event) => {
	                    event.preventDefault();
	                    event.stopPropagation();
	                    void copyCitation();
	                  }}
	                  onMouseDown={stopButtonMouseDown}
	                >
	                  {copied ? <Check size={11} aria-hidden="true" /> : <ClipboardCopy size={11} aria-hidden="true" />}
	                  {copied ? '已复制' : '复制'}
	                </button>
	                <button
	                  className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-background px-2 py-1 text-[11px] font-medium text-destructive transition hover:bg-destructive/10"
	                  type="button"
	                  onClick={(event) => {
	                    event.preventDefault();
	                    event.stopPropagation();
	                    deleteSourceLink();
	                  }}
	                  onMouseDown={stopButtonMouseDown}
	                >
	                  <Trash2 size={11} aria-hidden="true" />
	                  删除
	                </button>
	                <button
	                  className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted"
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setControlsOpen(false);
                  }}
                  onMouseDown={stopButtonMouseDown}
	                >
	                  <PanelTopClose size={11} aria-hidden="true" />
	                  退出工具
	                </button>
	              </span>
            </span>

            {sourceMeta.length > 0 ? (
              <span
                className={cn(
                  'flex flex-wrap gap-1 overflow-hidden transition-all duration-200 ease-out',
                  controlsOpen ? 'mt-2 max-h-16 opacity-100' : 'mt-0 max-h-0 opacity-0'
                )}
              >
                {sourceMeta.map((item) => (
                  <span
                    className="rounded-full border bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                    key={item}
                  >
                    {item}
                  </span>
                ))}
              </span>
            ) : null}

            <span
              className={cn(
                'block max-h-[340px] overflow-auto rounded-md border transition-all duration-200 ease-out',
                controlsOpen
                  ? 'mt-2 border-border bg-muted/20 px-3 py-2'
                  : 'mt-0 border-transparent bg-transparent px-0 py-0',
                previewAlignment === 'left' && 'mr-auto',
                previewAlignment === 'center' && 'mx-auto',
                previewAlignment === 'right' && 'ml-auto'
              )}
              style={{
                fontSize: previewMode === 'parsed' ? `${previewFontSize}px` : undefined,
                width: `${previewWidth}%`
              }}
            >
              {snapshotText || node.attrs.snapshotAssetPath ? (
                previewMode === 'original' ? (
                  <SourceLinkOriginalPreview
                    attrs={node.attrs}
                    pdfDocument={getPdfDocument?.() ?? null}
                    snapshotAssetContext={snapshotAssetContext ?? null}
                    snapshotText={snapshotText ?? ''}
                  />
                ) : (
                  <SourceSnapshotPreview
                    compact
                    flush
                    markdown={snapshotText ?? ''}
                    previewMode={previewMode}
                    relatedImagePath={node.attrs.snapshotAssetPath ?? null}
                    segmentType={node.attrs.segmentType ?? undefined}
                    sourceEntryId={node.attrs.sourceEntryId ?? null}
                    workspaceRoot={node.attrs.workspaceRoot ?? snapshotAssetContext?.workspaceRoot ?? null}
                  />
                )
              ) : (
                <span className="block rounded-md border border-dashed bg-muted/20 px-3 py-2">
                No source snapshot saved for this link.
                </span>
              )}
            </span>

	          </span>
	        </span>
	      ) : null}
    </NodeViewWrapper>
  );
}

function stopButtonMouseDown(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

function SourceLinkOriginalPreview({
  attrs,
  pdfDocument,
  snapshotAssetContext,
  snapshotText
}: {
  attrs: SourceLinkNodeAttrs;
  pdfDocument: PDFDocumentProxy | null;
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null;
  snapshotText: string;
}) {
  const [snapshotState, setSnapshotState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'failed';
    url: string | null;
  }>({ status: 'idle', url: null });
  const sourceSegment = useMemo<SourceSegment | null>(() => {
    if (!attrs.sourceBbox || !attrs.page) {
      return null;
    }
    return {
      asset_path: attrs.snapshotAssetPath ?? null,
      bbox: attrs.sourceBbox,
      markdown: snapshotText || null,
      page_idx: Math.max(0, attrs.page - 1),
      segment_type: attrs.segmentType ?? 'paragraph',
      text: snapshotText,
      uid: attrs.segmentUid ?? attrs.anchorId ?? 'source-link'
    };
  }, [
    attrs.anchorId,
    attrs.page,
    attrs.segmentType,
    attrs.segmentUid,
    attrs.snapshotAssetPath,
    attrs.sourceBbox,
    snapshotText
  ]);
  const snapshotCacheKey = useMemo(
    () => buildOriginalSnapshotCacheKey(attrs, snapshotAssetContext),
    [
      attrs.page,
      attrs.segmentUid,
      attrs.sourceBbox,
      attrs.sourceEntryId,
      snapshotAssetContext?.entryId,
      snapshotAssetContext?.noteId,
      snapshotAssetContext?.workspaceRoot
    ]
  );

  useEffect(() => {
    let cancelled = false;
    let releasePdfDocument: (() => void) | null = null;
    const cachedAssetPath = snapshotCacheKey
      ? readOriginalSnapshotAssetCache(snapshotCacheKey)
      : null;
    if (cachedAssetPath) {
      setSnapshotState({ status: 'ready', url: cachedAssetPath });
      return () => {
        cancelled = true;
      };
    }

    if (!sourceSegment?.bbox) {
      setSnapshotState({ status: 'idle', url: null });
      return () => {
        cancelled = true;
      };
    }

    setSnapshotState({ status: 'loading', url: null });
    void resolveSourcePdfDocument(pdfDocument, attrs, snapshotAssetContext).then(async (resolved) => {
      if (cancelled) {
        resolved.release();
        return;
      }
      releasePdfDocument = resolved.release;
      if (!resolved.document) {
        setSnapshotState({ status: 'failed', url: null });
        return;
      }
      const url = await readCachedPdfSegmentSnapshot(resolved.document, sourceSegment);
      releasePdfDocument?.();
      releasePdfDocument = null;
      if (cancelled) {
        return;
      }
      if (!url) {
        setSnapshotState({ status: 'failed', url: null });
        return;
      }

      const persistedUrl = snapshotCacheKey
        ? await persistOriginalSnapshotAsset(snapshotCacheKey, url, attrs, snapshotAssetContext)
        : null;
      if (cancelled) {
        return;
      }
      setSnapshotState({ status: 'ready', url: persistedUrl ?? url });
    });
    return () => {
      cancelled = true;
      releasePdfDocument?.();
      releasePdfDocument = null;
    };
  }, [attrs.anchorId, attrs.segmentUid, pdfDocument, snapshotAssetContext, snapshotCacheKey, sourceSegment]);

  if (snapshotState.status === 'ready' && snapshotState.url) {
    return (
      <SourceSnapshotPreview
        compact
        flush
        imageFillWidth
        markdown=""
        previewMode="original"
        relatedImagePath={snapshotState.url}
        segmentType={attrs.segmentType ?? undefined}
        sourceEntryId={snapshotState.url.startsWith('data:')
          ? attrs.sourceEntryId ?? null
          : snapshotAssetContext?.entryId ?? attrs.sourceEntryId ?? null}
        workspaceRoot={attrs.workspaceRoot ?? snapshotAssetContext?.workspaceRoot ?? null}
      />
    );
  }

  if (snapshotState.status === 'loading') {
    return (
      <span className="flex min-h-24 items-center justify-center rounded-sm border bg-white px-3 py-4 text-xs text-muted-foreground">
        正在后台读取 PDF 并生成原图截图…
      </span>
    );
  }

  if (snapshotState.status === 'failed' && attrs.sourceBbox) {
    return (
      <span className="block rounded-sm border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        原图截图生成失败。请确认来源 PDF 仍在当前工作区中。
      </span>
    );
  }

  return (
    <SourceSnapshotPreview
      compact
      flush
      imageFillWidth
      markdown={snapshotText}
      previewMode="original"
      relatedImagePath={attrs.snapshotAssetPath ?? null}
      segmentType={attrs.segmentType ?? undefined}
      sourceEntryId={attrs.sourceEntryId ?? null}
      workspaceRoot={attrs.workspaceRoot ?? snapshotAssetContext?.workspaceRoot ?? null}
    />
  );
}

const originalSnapshotAssetSaves = new Map<string, Promise<string | null>>();
const SOURCE_PDF_CACHE_LIMIT = 2;
const SOURCE_PDF_IDLE_DISPOSE_MS = 30_000;

type SourcePdfDocumentResource = {
  disposeTimer: number | null;
  lastUsedAt: number;
  promise: Promise<OwnedSourcePdfDocument | null>;
  refCount: number;
};

type OwnedSourcePdfDocument = {
  destroy: () => Promise<void>;
  document: PDFDocumentProxy;
};

const sourcePdfDocumentLoads = new Map<string, SourcePdfDocumentResource>();

function resolveSourcePdfDocument(
  pdfDocument: PDFDocumentProxy | null,
  attrs: SourceLinkNodeAttrs,
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null
) {
  if (pdfDocument) {
    return Promise.resolve({ document: pdfDocument, release: () => undefined });
  }
  if (!snapshotAssetContext?.workspaceRoot || !attrs.sourceEntryId) {
    return Promise.resolve({ document: null, release: () => undefined });
  }

  const cacheKey = [
    snapshotAssetContext.workspaceRoot,
    attrs.sourceEntryId
  ].join('|');
  const existing = sourcePdfDocumentLoads.get(cacheKey);
  if (existing) {
    existing.refCount += 1;
    existing.lastUsedAt = Date.now();
    if (existing.disposeTimer !== null) {
      window.clearTimeout(existing.disposeTimer);
      existing.disposeTimer = null;
    }
    sourcePdfDocumentLoads.delete(cacheKey);
    sourcePdfDocumentLoads.set(cacheKey, existing);
    return existing.promise.then((document) => ({
      document: document?.document ?? null,
      release: releaseSourcePdfDocument(cacheKey, existing)
    }));
  }

  const resource: SourcePdfDocumentResource = {
    disposeTimer: null,
    lastUsedAt: Date.now(),
    promise: Promise.resolve(null),
    refCount: 1
  };
  resource.promise = loadSourcePdfDocument(
    snapshotAssetContext.workspaceRoot,
    attrs.sourceEntryId
  ).catch(() => null).then((document) => {
    if (!document && sourcePdfDocumentLoads.get(cacheKey) === resource) {
      sourcePdfDocumentLoads.delete(cacheKey);
    }
    return document;
  });
  sourcePdfDocumentLoads.set(cacheKey, resource);
  trimSourcePdfDocumentCache();
  return resource.promise.then((document) => ({
    document: document?.document ?? null,
    release: releaseSourcePdfDocument(cacheKey, resource)
  }));
}

function releaseSourcePdfDocument(cacheKey: string, resource: SourcePdfDocumentResource) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    resource.refCount = Math.max(0, resource.refCount - 1);
    resource.lastUsedAt = Date.now();
    if (resource.refCount > 0 || sourcePdfDocumentLoads.get(cacheKey) !== resource) return;
    resource.disposeTimer = window.setTimeout(() => {
      disposeSourcePdfDocument(cacheKey, resource);
    }, SOURCE_PDF_IDLE_DISPOSE_MS);
  };
}

function trimSourcePdfDocumentCache() {
  if (sourcePdfDocumentLoads.size <= SOURCE_PDF_CACHE_LIMIT) return;
  const candidates = [...sourcePdfDocumentLoads.entries()]
    .filter(([, resource]) => resource.refCount === 0)
    .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt);
  for (const [key, resource] of candidates) {
    if (sourcePdfDocumentLoads.size <= SOURCE_PDF_CACHE_LIMIT) break;
    disposeSourcePdfDocument(key, resource);
  }
}

function disposeSourcePdfDocument(cacheKey: string, resource: SourcePdfDocumentResource) {
  if (resource.refCount > 0 || sourcePdfDocumentLoads.get(cacheKey) !== resource) return;
  sourcePdfDocumentLoads.delete(cacheKey);
  if (resource.disposeTimer !== null) {
    window.clearTimeout(resource.disposeTimer);
    resource.disposeTimer = null;
  }
  void resource.promise.then((document) => document?.destroy());
}

async function loadSourcePdfDocument(root: string, sourceEntryId: string) {
  const reader = await readPdfReader(root, sourceEntryId);
  const bytes = await readPdfBytes(reader.pdf_path);
  const [pdfjsLib, pdfWorkerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?worker')
  ]);
  if (
    typeof window !== 'undefined' &&
    'Worker' in window &&
    !pdfjsLib.GlobalWorkerOptions.workerPort
  ) {
    const PdfWorker = pdfWorkerModule.default;
    pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
  }
  const loadingTask = pdfjsLib.getDocument(createPdfDocumentOptions(new Uint8Array(bytes)));
  const document = await loadingTask.promise;
  return {
    destroy: () => loadingTask.destroy(),
    document
  };
}

function buildOriginalSnapshotCacheKey(
  attrs: SourceLinkNodeAttrs,
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null
) {
  if (
    !snapshotAssetContext?.workspaceRoot ||
    !attrs.sourceEntryId ||
    !attrs.segmentUid ||
    !attrs.page ||
    !attrs.sourceBbox
  ) {
    return null;
  }

  return [
    'neuink.sourceLinkOriginalSnapshot.v1',
    snapshotAssetContext.workspaceRoot,
    snapshotAssetContext.entryId,
    snapshotAssetContext.noteId,
    attrs.sourceEntryId,
    attrs.segmentUid,
    attrs.page,
    attrs.sourceBbox.map((value) => Number(value).toFixed(3)).join(',')
  ].join('|');
}

function readOriginalSnapshotAssetCache(cacheKey: string) {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(cacheKey);
  } catch {
    return null;
  }
}

function writeOriginalSnapshotAssetCache(cacheKey: string, assetPath: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(cacheKey, assetPath);
  } catch {
    // Best-effort cache only. The preview can still use the in-memory data URL.
  }
}

async function persistOriginalSnapshotAsset(
  cacheKey: string,
  dataUrl: string,
  attrs: SourceLinkNodeAttrs,
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null
) {
  const existing = originalSnapshotAssetSaves.get(cacheKey);
  if (existing) {
    return existing;
  }

  const task = persistOriginalSnapshotAssetOnce(dataUrl, attrs, snapshotAssetContext)
    .then((assetPath) => {
      if (assetPath) {
        writeOriginalSnapshotAssetCache(cacheKey, assetPath);
      }
      return assetPath;
    })
    .catch(() => null)
    .finally(() => originalSnapshotAssetSaves.delete(cacheKey));
  originalSnapshotAssetSaves.set(cacheKey, task);
  return task;
}

async function persistOriginalSnapshotAssetOnce(
  dataUrl: string,
  attrs: SourceLinkNodeAttrs,
  snapshotAssetContext: SourceLinkSnapshotAssetContext | null
) {
  const payload = parsePngDataUrl(dataUrl);
  if (!payload || !snapshotAssetContext?.workspaceRoot) {
    return null;
  }

  const saved = await saveNoteAssetBytes(
    snapshotAssetContext.workspaceRoot,
    snapshotAssetContext.entryId,
    snapshotAssetContext.noteId,
    payload.mimeType,
    payload.base64,
    originalSnapshotAssetFileName(attrs)
  );
  return saved.markdown_path;
}

function parsePngDataUrl(value: string) {
  const match = /^data:(image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) {
    return null;
  }
  return {
    base64: match[2],
    mimeType: match[1]
  };
}

function originalSnapshotAssetFileName(attrs: SourceLinkNodeAttrs) {
  const segmentUid = (attrs.segmentUid || attrs.anchorId || 'source-link')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `source-original-${segmentUid || 'snapshot'}.png`;
}

function inferCodeLanguage(markdown?: string | null) {
  const match = markdown?.trim().match(/^```([A-Za-z0-9_+.#-]+)/);
  return match?.[1] ?? null;
}

function buildSourceLinkCitation(attrs: SourceLinkNodeAttrs, fallbackLabel: string) {
  const snapshot = attrs.snapshotText?.replace(/\s+/g, ' ').trim() ?? '';
  const excerpt = snapshot.length > 220 ? `${snapshot.slice(0, 217).trimEnd()}...` : snapshot;
  const parts = [
    fallbackLabel || attrs.displayText || attrs.anchorId || UI_TERMS.sourceLink,
    attrs.page ? `p.${attrs.page}` : null,
    attrs.segmentUid ? `${UI_TERMS.segment} ${attrs.segmentUid}` : null,
    excerpt ? `"${excerpt}"` : null
  ].filter(Boolean);

  return parts.join('\n');
}

function normalizePreviewMode(value?: string | null): SourceLinkPreviewMode {
  return value === 'original' ? 'original' : 'parsed';
}

function normalizePreviewAlignment(value?: string | null): SourceLinkPreviewAlignment {
  return value === 'left' || value === 'right' ? value : 'center';
}

function normalizePreviewWidth(value?: number | string | null) {
  const numeric = Number(value ?? 100);
  if (!Number.isFinite(numeric)) {
    return 100;
  }
  return Math.min(100, Math.max(24, Math.round(numeric)));
}

function normalizePreviewFontSize(value?: number | string | null) {
  const numeric = Number(value ?? 13);
  if (!Number.isFinite(numeric)) {
    return 13;
  }
  return Math.min(20, Math.max(11, Math.round(numeric)));
}

function sourceLinkStorageKey(anchorId: string) {
  return `neuink.sourceLinkPreview.${anchorId}`;
}

function readPersistedSourceLinkState(anchorId: string): PersistedSourceLinkState {
  if (!anchorId || typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(sourceLinkStorageKey(anchorId));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as PersistedSourceLinkState;
    return {
      expanded: typeof parsed.expanded === 'boolean' ? parsed.expanded : undefined,
      previewAlignment: normalizePreviewAlignment(parsed.previewAlignment),
      previewFontSize: normalizePreviewFontSize(parsed.previewFontSize),
      previewMode: normalizePreviewMode(parsed.previewMode),
      previewWidth: normalizePreviewWidth(parsed.previewWidth)
    };
  } catch {
    return {};
  }
}

function writePersistedSourceLinkState(anchorId: string, state: PersistedSourceLinkState) {
  if (!anchorId || typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(sourceLinkStorageKey(anchorId), JSON.stringify(state));
  } catch {
    // localStorage may be unavailable in private contexts; node attrs still keep
    // the current editor session in sync.
  }
}
