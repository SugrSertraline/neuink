import { Loader2 } from 'lucide-react';
import { TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import { memo, useEffect, useRef, useState } from 'react';

import type { AnnotationHighlightColor } from '@/shared/types/domain';

import {
  applyPdfLayerSize,
  copyPdfTextSelection,
  isPdfRenderCancellation,
  scheduleIdleWork
} from './pdfCanvasDom';
import { schedulePdfRenderContinuation } from './pdfRenderScheduler';

const DEFAULT_PAGE_ASPECT_RATIO = 1.414;

export type PdfTextSelectionHighlight = {
  color: AnnotationHighlightColor;
  id: string;
  rect: readonly [number, number, number, number];
};

function PdfCanvasPageImpl({
  pageIdx,
  pageWidth,
  pdfDocument,
  renderPriority,
  renderEnabled
}: {
  pageIdx: number;
  pageWidth: number;
  pdfDocument: PDFDocumentProxy;
  renderPriority: 'preload' | 'visible';
  renderEnabled: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const hasRenderedPageRef = useRef(false);
  const pageAspectRatioRef = useRef(DEFAULT_PAGE_ASPECT_RATIO);
  const [pageSize, setPageSize] = useState<{
    height: number;
    width: number;
  } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    hasRenderedPageRef.current = false;
    pageAspectRatioRef.current = DEFAULT_PAGE_ASPECT_RATIO;
    setPageSize(null);
  }, [pageIdx, pdfDocument]);

  useEffect(() => {
    if (!renderEnabled || !hasRenderedPageRef.current) {
      return;
    }

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
  }, [renderEnabled]);

  useEffect(
    () => () => releasePdfPageLayers(canvasRef.current, textLayerRef.current),
    []
  );

  useEffect(() => {
    if (!renderEnabled) {
      return undefined;
    }

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    let page: PDFPageProxy | null = null;
    let renderCanvas: HTMLCanvasElement | null = null;
    let cancelTextLayerSchedule: (() => void) | null = null;
    let cancelRenderContinuation: (() => void) | null = null;
    const renderDelay = renderPriority === 'visible'
      ? hasRenderedPageRef.current ? 120 : 0
      : 420 + (pageIdx % 4) * 90;

    async function renderPage() {
      const canvas = canvasRef.current;
      const textLayerElement = textLayerRef.current;

      if (!canvas || !textLayerElement) {
        return;
      }

      try {
        setRenderError(null);

        page = await pdfDocument.getPage(pageIdx + 1);

        if (cancelled) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const scale = pageWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const nextSize = {
          width: viewport.width,
          height: viewport.height
        };
        const outputScale = window.devicePixelRatio || 1;
        renderCanvas = document.createElement('canvas');
        const renderContext = renderCanvas.getContext('2d');
        const visibleContext = canvas.getContext('2d');

        if (!renderContext || !visibleContext) {
          setRenderError('Unable to create the PDF canvas context.');
          return;
        }

        renderCanvas.width = Math.floor(viewport.width * outputScale);
        renderCanvas.height = Math.floor(viewport.height * outputScale);
        applyPdfLayerSize(canvas, nextSize);
        applyPdfLayerSize(textLayerElement, nextSize);
        textLayerElement.style.setProperty('--total-scale-factor', `${scale}`);
        textLayerElement.style.setProperty('--scale-round-x', '1px');
        textLayerElement.style.setProperty('--scale-round-y', '1px');

        renderTask = page.render({
          canvas: renderCanvas,
          canvasContext: renderContext,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0]
        });
        renderTask.onContinue = (continueRendering: () => void) => {
          cancelRenderContinuation?.();
          cancelRenderContinuation = schedulePdfRenderContinuation(
            continueRendering,
            renderPriority
          );
        };

        await renderTask.promise;
        cancelRenderContinuation = null;

        if (cancelled) {
          return;
        }

        canvas.width = renderCanvas.width;
        canvas.height = renderCanvas.height;
        applyPdfLayerSize(canvas, nextSize);
        visibleContext.clearRect(0, 0, canvas.width, canvas.height);
        visibleContext.drawImage(renderCanvas, 0, 0);
        renderCanvas.width = 0;
        renderCanvas.height = 0;
        renderCanvas = null;

        pageAspectRatioRef.current = baseViewport.height / baseViewport.width;
        hasRenderedPageRef.current = true;
        setPageSize(nextSize);

        if (renderPriority === 'preload') {
          return;
        }

        await new Promise<void>((resolve) => {
          cancelTextLayerSchedule = scheduleIdleWork(resolve);
        });
        cancelTextLayerSchedule = null;
        if (cancelled) {
          return;
        }

        try {
          textLayerElement.replaceChildren();
          textLayer = new TextLayer({
            container: textLayerElement,
            textContentSource: page.streamTextContent({
              includeMarkedContent: true,
              disableNormalization: true
            }),
            viewport
          });
          applyPdfLayerSize(textLayerElement, nextSize);

          await textLayer.render();
        } catch (caught) {
          if (!cancelled && !isPdfRenderCancellation(caught)) {
            console.warn('[pdf-reader] PDF text layer rendering failed.', {
              errorName: caught instanceof Error ? caught.name : 'UnknownError'
            });
          }
        }
      } catch (caught) {
        if (!cancelled && !isPdfRenderCancellation(caught)) {
          setRenderError(
            caught instanceof Error ? caught.message : 'Unable to render this PDF page.'
          );
        }
      }
    }

    const renderTimeout = window.setTimeout(() => {
      void renderPage();
    }, renderDelay);

    return () => {
      cancelled = true;
      window.clearTimeout(renderTimeout);
      renderTask?.cancel();
      textLayer?.cancel();
      cancelRenderContinuation?.();
      cancelTextLayerSchedule?.();
      if (renderCanvas) {
        renderCanvas.width = 0;
        renderCanvas.height = 0;
        renderCanvas = null;
      }
      page?.cleanup?.();
      page = null;
    };
  }, [pageIdx, pageWidth, pdfDocument, renderEnabled, renderPriority]);

  return (
    <div
      className="relative z-[2] isolate bg-white"
      style={{
        height: pageSize
          ? `${pageSize.height}px`
          : `${pageWidth * DEFAULT_PAGE_ASPECT_RATIO}px`,
        width: pageSize ? `${pageSize.width}px` : `${pageWidth}px`
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-0 block bg-white"
      />

      <div
        ref={textLayerRef}
        className="pdf-text-layer absolute inset-0 z-[2]"
        onCopy={(event) => copyPdfTextSelection(event, textLayerRef.current)}
      />

      {!pageSize ? (
        <div className="absolute inset-0 z-[3] grid place-items-center text-xs text-muted-foreground">
          <Loader2 className="animate-spin" size={16} aria-hidden="true" />
        </div>
      ) : null}

      {renderError ? (
        <div className="absolute inset-0 z-[3] grid place-items-center bg-background/90 px-4 text-center text-sm text-destructive">
          {renderError}
        </div>
      ) : null}
    </div>
  );
}

// Persisted annotation changes must not make PDF.js rebuild the canvas or text
// layer. The raster page only updates when its actual render inputs change.
export const PdfCanvasPage = memo(PdfCanvasPageImpl);

export function PdfTextSelectionHighlightLayer({
  highlights
}: {
  highlights: PdfTextSelectionHighlight[];
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[2]" aria-hidden="true">
      {highlights.map(({ color, id, rect }) => (
        <span
          className="absolute rounded-[1px]"
          data-pdf-text-highlight="true"
          key={id}
          style={textSelectionHighlightStyle(rect, color)}
        />
      ))}
    </div>
  );
}

function releasePdfPageLayers(
  canvas: HTMLCanvasElement | null,
  textLayer: HTMLDivElement | null
) {
  if (canvas) {
    canvas.width = 0;
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
  if (color === 'green') {
    return 'rgb(110 231 183 / 0.38)';
  }
  if (color === 'blue') {
    return 'rgb(125 211 252 / 0.38)';
  }
  if (color === 'pink') {
    return 'rgb(249 168 212 / 0.38)';
  }
  return 'rgb(253 224 71 / 0.4)';
}
