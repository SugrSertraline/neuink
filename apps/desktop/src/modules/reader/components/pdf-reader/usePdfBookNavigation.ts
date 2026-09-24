import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { bookRowForPage, registerPdfPageReveal } from './pdfPageNavigation';
import { animatePdfPageTurn } from './pdfPageTurn';
import { scrollToPage } from './readerUtils';
import type { PageSegments } from './types';

export function usePdfBookNavigation({ enabled, entryId, rows, scrollRef, document: pdfDocument,
  continuousPages, pageWidth, zoom, leftInset = 0,
}: { enabled: boolean; entryId: string; rows: PageSegments[][]; scrollRef: RefObject<HTMLDivElement>;
  document: PDFDocumentProxy | null; continuousPages: Set<number>; pageWidth: number; zoom: number; leftInset?: number }) {
  const [pageIdx, setPageIdx] = useState(0);
  const lastPage = useRef(0);
  const pending = useRef<(() => void) | null>(null);
  const cancelTurn = useRef<(() => void) | null>(null);
  const turningTo = useRef<{ pageIdx: number; afterReveal: () => void } | null>(null);
  const [height, setHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [aspect, setAspect] = useState(1 / Math.sqrt(2));
  const rowIndex = bookRowForPage(rows, pageIdx);
  const row = rows[rowIndex];
  const visible = useMemo(() => new Set(row?.map(page => page.pageIdx) ?? []), [row]);
  const render = useMemo(() => new Set(rows.slice(Math.max(0, rowIndex - 1), rowIndex + 2).flat().map(page => page.pageIdx)), [rows, rowIndex]);
  const modeRef = useRef(enabled);

  useLayoutEffect(() => {
    setPageIdx(0); lastPage.current = 0; pending.current = null; cancelTurn.current?.();
  }, [entryId]);
  useLayoutEffect(() => {
    if (!enabled && !modeRef.current && continuousPages.size) lastPage.current = Math.min(...continuousPages);
  }, [continuousPages, enabled]);
  useLayoutEffect(() => {
    if (modeRef.current === enabled) return;
    modeRef.current = enabled;
    cancelTurn.current?.();
    if (enabled) setPageIdx(lastPage.current);
    else scrollToPage(lastPage.current, scrollRef.current);
  }, [enabled, scrollRef]);
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container || !enabled || !pdfDocument) return;
    return registerPdfPageReveal(container, (requestedPage, afterReveal) => {
      if (!Number.isInteger(requestedPage) || requestedPage < 0 || requestedPage >= pdfDocument.numPages) return false;
      const nextRow = bookRowForPage(rows, requestedPage);
      if (turningTo.current?.pageIdx === requestedPage) {
        turningTo.current.afterReveal = afterReveal;
        return true;
      }
      cancelTurn.current?.();
      if (nextRow === rowIndex) return false;
      const reveal = () => { pending.current = turningTo.current?.afterReveal ?? afterReveal; setPageIdx(requestedPage); };
      // Only adjacent leaf turns animate. Search/source jumps stay immediate.
      const destination = rows[nextRow];
      if (Math.abs(nextRow - rowIndex) === 1 && destination?.length === row?.length) {
        const direction = nextRow > rowIndex ? 1 : -1;
        const outgoing = direction === 1 ? row?.[row.length - 1]?.pageIdx : row?.[0]?.pageIdx;
        if (outgoing !== undefined) {
          let cancelled = false;
          const dispose = animatePdfPageTurn(container, {
            pageIdx: outgoing, direction,
            underPageIdx: direction === 1 ? destination[destination.length - 1].pageIdx : destination[0].pageIdx,
            backPageIdx: destination.length > 1 ? (direction === 1 ? destination[0].pageIdx : destination[destination.length - 1].pageIdx) : undefined,
            onComplete: () => { if (!cancelled) reveal(); },
          });
          if (dispose) {
            turningTo.current = { pageIdx: requestedPage, afterReveal };
            cancelTurn.current = () => {
              cancelled = true; dispose(); turningTo.current = null; cancelTurn.current = null;
            };
            return true;
          }
        }
      }
      reveal();
      return true;
    });
  }, [enabled, pdfDocument, row, rowIndex, rows, scrollRef]);
  useLayoutEffect(() => {
    if (!enabled) return;
    cancelTurn.current?.();
    lastPage.current = row?.[0]?.pageIdx ?? 0;
    const callback = pending.current; pending.current = null;
    callback?.();
  }, [enabled, row]);
  // Changing spread geometry or document invalidates the captured paper.
  useLayoutEffect(() => () => cancelTurn.current?.(), [rows, pageWidth, zoom, pdfDocument]);
  useEffect(() => {
    if (!enabled || !pdfDocument || !row?.length) return;
    let cancelled = false;
    void Promise.all(row.map(page => pdfDocument.getPage(page.pageIdx + 1))).then(pages => {
      if (!cancelled) setAspect(Math.min(...pages.map(page => { const v = page.getViewport({scale: 1}); return v.width / v.height; })));
    }).catch(() => { /* PdfCanvasPage owns the visible render error and retry. */ });
    return () => { cancelled = true; };
  }, [enabled, pdfDocument, row]);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !enabled) return;
    const measure = () => {
      const inset = parseFloat(getComputedStyle(container).scrollPaddingTop) || 0;
      setHeight(Math.max(0, container.clientHeight - inset));
      setViewportWidth(container.clientWidth);
      cancelTurn.current?.();
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(container);
    const media = window.matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)');
    const stop = () => cancelTurn.current?.();
    media.addEventListener('change', stop);
    document.addEventListener('visibilitychange', stop);
    return () => { observer.disconnect(); media.removeEventListener('change', stop); document.removeEventListener('visibilitychange', stop); stop(); };
  }, [enabled, scrollRef]);
  useEffect(() => () => cancelTurn.current?.(), []);

  const columns = row?.length || 1;
  const widthLimit = viewportWidth > 0 ? (viewportWidth - leftInset - 112 - (columns - 1) * 2) / columns - 2 : pageWidth / zoom;
  return { rowIndex, visible, render,
    pageWidth: enabled && height > 140 ? Math.max(80, Math.min(pageWidth / zoom, (height - 112) * aspect, widthLimit)) * zoom : pageWidth,
    previousPage: rows[rowIndex - 1]?.[0]?.pageIdx,
    nextPage: rows[rowIndex + 1]?.[0]?.pageIdx,
  };
}
