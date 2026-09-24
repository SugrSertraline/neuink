import { Loader2, RotateCcw } from 'lucide-react';
import { TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { memo, useEffect, useRef, useState } from 'react';

import type { AnnotationHighlightColor } from '@/shared/types/domain';
import { Button } from '@/components/ui/button';

import {
  applyPdfLayerSize,
  copyPdfTextSelection,
  isPdfRenderCancellation,
  scheduleIdleWork
} from './pdfCanvasDom';
import {
  schedulePdfRenderJob,
  type PdfRenderJobHandle
} from './pdfRenderQueue';
import { schedulePdfRenderContinuation } from './pdfRenderScheduler';

const DEFAULT_PAGE_ASPECT_RATIO = 1.414;
const TEXT_LAYER_RENDER_DELAY_MS = 240;

export type PdfTextSelectionHighlight = {
  active?: boolean;
  color: AnnotationHighlightColor;
  id: string;
  rect: readonly [number, number, number, number];
};

function PdfCanvasPageImpl({
  pageIdx,
  pageWidth,
  pdfDocument,
  renderPriority,
  renderEnabled,
  searchActive = false,
  searchQuery = ''
}: {
  pageIdx: number;
  pageWidth: number;
  pdfDocument: PDFDocumentProxy;
  renderPriority: 'preload' | 'visible';
  renderEnabled: boolean;
  searchActive?: boolean;
  searchQuery?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<PDFPageProxy | null>(null);
  const rasterJobRef = useRef<PdfRenderJobHandle | null>(null);
  const renderPriorityRef = useRef(renderPriority);
  const hasRenderedPageRef = useRef(false);
  const renderedPageWidthRef = useRef<number | null>(null);
  const pageAspectRatioRef = useRef(DEFAULT_PAGE_ASPECT_RATIO);
  const searchActiveRef = useRef(searchActive);
  const searchQueryRef = useRef(searchQuery);
  const [pageSize, setPageSize] = useState<{ height: number; width: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderAttempt, setRenderAttempt] = useState(0);

  renderPriorityRef.current = renderPriority;
  searchActiveRef.current = searchActive;
  searchQueryRef.current = searchQuery;

  useEffect(() => {
    hasRenderedPageRef.current = false;
    renderedPageWidthRef.current = null;
    pageAspectRatioRef.current = DEFAULT_PAGE_ASPECT_RATIO;
    setPageSize(null);
    setRenderError(null);

    return () => {
      pageRef.current?.cleanup?.();
      pageRef.current = null;
    };
  }, [pageIdx, pdfDocument]);

  useEffect(() => {
    rasterJobRef.current?.setKind(rasterJobKind(renderPriority));
  }, [renderPriority]);

  useEffect(() => {
    if (!renderEnabled || !hasRenderedPageRef.current) return;
    const nextSize = {
      width: pageWidth,
      height: pageWidth * pageAspectRatioRef.current
    };
    setPageSize(nextSize);
    applyPdfLayerSize(canvasRef.current, nextSize);
    applyPdfLayerSize(textLayerRef.current, nextSize);
  }, [pageWidth, renderEnabled]);

  useEffect(() => {
    if (renderEnabled) return;
    releasePdfPageLayers(canvasRef.current, textLayerRef.current);
    hasRenderedPageRef.current = false;
    renderedPageWidthRef.current = null;
    setPageSize(null);
    pageRef.current?.cleanup?.();
    pageRef.current = null;
  }, [renderEnabled]);

  useEffect(
    () => () => releasePdfPageLayers(canvasRef.current, textLayerRef.current),
    []
  );

  useEffect(() => {
    if (!renderEnabled) return undefined;
    const canvas = canvasRef.current;
    const textLayerElement = textLayerRef.current;
    if (!canvas || !textLayerElement) return undefined;
    if (hasRenderedPageRef.current && renderedPageWidthRef.current === pageWidth) {
      return undefined;
    }

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let renderCanvas: HTMLCanvasElement | null = null;
    let cancelRenderContinuation: (() => void) | null = null;

    const releaseRenderCanvas = () => {
      if (!renderCanvas) return;
      renderCanvas.width = 0;
      renderCanvas.height = 0;
      renderCanvas = null;
    };

    const renderPage = async (signal: AbortSignal) => {
      renderTask = null;
      releaseRenderCanvas();
      const abortRaster = () => {
        renderTask?.cancel();
        cancelRenderContinuation?.();
        cancelRenderContinuation = null;
        releaseRenderCanvas();
      };
      signal.addEventListener('abort', abortRaster, { once: true });

      try {
        setRenderError(null);
        const page = await pdfDocument.getPage(pageIdx + 1);
        if (cancelled || signal.aborted) return;
        pageRef.current = page;

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = pageWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const nextSize = { width: viewport.width, height: viewport.height };
        const outputScale = window.devicePixelRatio || 1;
        renderCanvas = document.createElement('canvas');
        const renderContext = renderCanvas.getContext('2d');
        const visibleContext = canvas.getContext('2d');
        if (!renderContext || !visibleContext) {
          setRenderError('Unable to create the PDF canvas context.');
          return;
        }

        applyTextLayerViewport(textLayerElement, nextSize, scale);
        renderCanvas.width = Math.floor(viewport.width * outputScale);
        renderCanvas.height = Math.floor(viewport.height * outputScale);
        renderTask = page.render({
          canvas: renderCanvas,
          canvasContext: renderContext,
          viewport,
          transform: outputScale === 1
            ? undefined
            : [outputScale, 0, 0, outputScale, 0, 0]
        });
        renderTask.onContinue = (continueRendering: () => void) => {
          cancelRenderContinuation?.();
          cancelRenderContinuation = schedulePdfRenderContinuation(
            continueRendering,
            renderPriorityRef.current
          );
        };
        await renderTask.promise;
        cancelRenderContinuation = null;
        if (cancelled || signal.aborted || !renderCanvas) return;

        canvas.width = renderCanvas.width;
        canvas.height = renderCanvas.height;
        applyPdfLayerSize(canvas, nextSize);
        visibleContext.clearRect(0, 0, canvas.width, canvas.height);
        visibleContext.drawImage(renderCanvas, 0, 0);
        canvas.dataset.pdfRendered = 'true';
        releaseRenderCanvas();
        pageAspectRatioRef.current = baseViewport.height / baseViewport.width;
        hasRenderedPageRef.current = true;
        renderedPageWidthRef.current = pageWidth;
        setPageSize(nextSize);
      } catch (caught) {
        if (!cancelled && !signal.aborted && !isPdfRenderCancellation(caught)) {
          setRenderError(
            caught instanceof Error ? caught.message : 'Unable to render this PDF page.'
          );
        }
      } finally {
        signal.removeEventListener('abort', abortRaster);
      }
    };

    const job = schedulePdfRenderJob({
      kind: rasterJobKind(renderPriorityRef.current),
      retryOnPreempt: true,
      run: renderPage
    });
    rasterJobRef.current = job;

    return () => {
      cancelled = true;
      job.cancel();
      if (rasterJobRef.current === job) rasterJobRef.current = null;
      renderTask?.cancel();
      cancelRenderContinuation?.();
      releaseRenderCanvas();
    };
  }, [pageIdx, pageWidth, pdfDocument, renderAttempt, renderEnabled]);

  useEffect(() => {
    const textLayerElement = textLayerRef.current;
    if (!textLayerElement) return undefined;
    textLayerElement.replaceChildren();
    if (
      !renderEnabled ||
      renderPriority !== 'visible' ||
      !hasRenderedPageRef.current ||
      renderedPageWidthRef.current !== pageWidth ||
      !pageRef.current ||
      !pageSize
    ) {
      return undefined;
    }

    let cancelled = false;
    let cancelTextLayerJob: (() => void) | null = null;
    const page = pageRef.current;
    const baseViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pageWidth / baseViewport.width });
    const cancelSchedule = scheduleIdleWork(() => {
      if (cancelled) return;
      const job = schedulePdfRenderJob({
        kind: 'text-layer',
        retryOnPreempt: true,
        run: async (signal) => {
          if (cancelled) return;
          const stagingLayer = document.createElement('div');
          const textLayer = new TextLayer({
            container: stagingLayer,
            textContentSource: page.streamTextContent({
              includeMarkedContent: true,
              disableNormalization: true
            }),
            viewport
          });
          const abortTextLayer = () => textLayer.cancel();
          signal.addEventListener('abort', abortTextLayer, { once: true });
          try {
            await textLayer.render();
            if (cancelled || signal.aborted) return;
            const minFontSize = stagingLayer.style.getPropertyValue('--min-font-size');
            if (minFontSize) {
              textLayerElement.style.setProperty('--min-font-size', minFontSize);
            }
            textLayerElement.replaceChildren(...stagingLayer.childNodes);
            applyPdfTextSearchHighlights(
              textLayerElement,
              searchQueryRef.current,
              searchActiveRef.current
            );
          } catch (caught) {
            if (!cancelled && !signal.aborted && !isPdfRenderCancellation(caught)) {
              console.warn('[pdf-reader] PDF text layer rendering failed.', {
                errorName: caught instanceof Error ? caught.name : 'UnknownError'
              });
            }
          } finally {
            signal.removeEventListener('abort', abortTextLayer);
            stagingLayer.replaceChildren();
          }
        }
      });
      cancelTextLayerJob = job.cancel;
    }, TEXT_LAYER_RENDER_DELAY_MS);

    return () => {
      cancelled = true;
      cancelSchedule();
      cancelTextLayerJob?.();
      textLayerElement.replaceChildren();
    };
  }, [pageIdx, pageWidth, pdfDocument, renderEnabled, renderPriority, pageSize]);

  useEffect(() => {
    applyPdfTextSearchHighlights(textLayerRef.current, searchQuery, searchActive);
  }, [searchActive, searchQuery]);

  const displayAspectRatio = pageSize && pageSize.width > 0
    ? pageSize.height / pageSize.width
    : pageAspectRatioRef.current;

  return (
    <div
      className="relative z-[2] isolate bg-white"
      style={{
        height: `${pageWidth * displayAspectRatio}px`,
        width: `${pageWidth}px`
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 z-0 block bg-white" />
      <div
        ref={textLayerRef}
        className="pdf-text-layer absolute inset-0 z-[2]"
        onCopy={(event) => copyPdfTextSelection(event, textLayerRef.current)}
      />
      {!pageSize && !renderError ? (
        <div className="absolute inset-0 z-[3] grid place-items-center text-xs text-muted-foreground">
          <Loader2 className="animate-spin" size={16} aria-hidden="true" />
        </div>
      ) : null}
      {renderError ? (
        <div className="absolute inset-0 z-[3] grid place-items-center bg-background/95 px-4 text-center">
          <div className="grid max-w-sm justify-items-center gap-3">
            <p className="text-sm text-destructive">{renderError}</p>
            <Button
              size="sm"
              type="button"
              variant="outline"
              onClick={() => {
                rasterJobRef.current?.cancel();
                hasRenderedPageRef.current = false;
                renderedPageWidthRef.current = null;
                setRenderError(null);
                setPageSize(null);
                setRenderAttempt((attempt) => attempt + 1);
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              重试此页
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Persisted annotation changes must not make PDF.js rebuild the canvas or text
// layer. The raster page only updates when its actual render inputs change.
export const PdfCanvasPage = memo(PdfCanvasPageImpl);

export function applyPdfTextSearchHighlights(
  textLayerElement: HTMLElement | null,
  query: string,
  active: boolean
) {
  if (!textLayerElement) return;
  const normalizedQuery = query.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  const spans = Array.from(textLayerElement.querySelectorAll<HTMLElement>('span'));
  let activeAssigned = false;
  for (const span of spans) {
    span.classList.remove('pdf-search-match', 'pdf-search-match-active');
    if (!normalizedQuery) continue;
    const text = span.textContent?.replace(/\s+/g, ' ').toLocaleLowerCase() ?? '';
    if (!text.includes(normalizedQuery)) continue;
    span.classList.add('pdf-search-match');
    if (active && !activeAssigned) {
      span.classList.add('pdf-search-match-active');
      activeAssigned = true;
    }
  }
}

export function PdfTextSelectionHighlightLayer({
  highlights
}: {
  highlights: PdfTextSelectionHighlight[];
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[2]" aria-hidden="true">
      {highlights.map(({ active = false, color, id, rect }) => (
        <span
          className={`absolute rounded-[1px] ${active ? 'pdf-annotation-highlight-active' : ''}`}
          data-pdf-annotation-active={active ? 'true' : undefined}
          data-pdf-text-highlight="true"
          key={id}
          style={textSelectionHighlightStyle(rect, color)}
        />
      ))}
    </div>
  );
}

function rasterJobKind(priority: 'preload' | 'visible') {
  return priority === 'visible' ? 'visible-raster' as const : 'preload-raster' as const;
}

function applyTextLayerViewport(
  element: HTMLDivElement,
  size: { height: number; width: number },
  scale: number
) {
  applyPdfLayerSize(element, size);
  element.style.setProperty('--total-scale-factor', `${scale}`);
  element.style.setProperty('--scale-round-x', '1px');
  element.style.setProperty('--scale-round-y', '1px');
}

function releasePdfPageLayers(
  canvas: HTMLCanvasElement | null,
  textLayer: HTMLDivElement | null
) {
  if (canvas) {
    canvas.width = 0;
    delete canvas.dataset.pdfRendered;
    canvas.height = 0;
  }
  textLayer?.replaceChildren();
}

function textSelectionHighlightStyle(
  rect: readonly [number, number, number, number],
  color: AnnotationHighlightColor
) {
  const [x0, y0, x1, y1] = rect;
  return {
    backgroundColor: textSelectionColor(color),
    mixBlendMode: 'multiply' as const,
    left: `${x0 / 10}%`,
    top: `${y0 / 10}%`,
    width: `${Math.max(0.4, x1 - x0) / 10}%`,
    height: `${Math.max(0.4, y1 - y0) / 10}%`
  };
}

function textSelectionColor(color: AnnotationHighlightColor) {
  if (color === 'green') return 'rgb(110 231 183 / 0.38)';
  if (color === 'blue') return 'rgb(125 211 252 / 0.38)';
  if (color === 'pink') return 'rgb(249 168 212 / 0.38)';
  return 'rgb(253 224 71 / 0.4)';
}
