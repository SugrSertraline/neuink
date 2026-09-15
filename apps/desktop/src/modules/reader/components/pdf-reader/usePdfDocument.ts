import { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

import { createPdfDocumentOptions } from './pdfDocumentOptions';

export type PdfLoadState =
  | { status: 'idle' | 'loading'; document: null; error: null }
  | { status: 'ready'; document: PDFDocumentProxy; error: null }
  | { status: 'error'; document: null; error: string };

export function usePdfDocument(pdfBytes: Uint8Array | null): PdfLoadState {
  const [pdfState, setPdfState] = useState<PdfLoadState>({
    status: 'idle',
    document: null,
    error: null
  });

  useEffect(() => {
    if (!pdfBytes) {
      setPdfState({ status: 'idle', document: null, error: null });
      return undefined;
    }

    let cancelled = false;
    setPdfState({ status: 'loading', document: null, error: null });
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    let nativeWorker: Worker | null = null;
    let worker: pdfjsLib.PDFWorker | null = null;
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      // Each document owns its worker. A newly mounted reader must never reuse a
      // global worker whose asynchronous destruction is still in progress.
      void Promise.resolve().then(() => loadingTask?.destroy()).catch(() => {
        console.warn('PDF 读取任务释放失败，正在清理独立线程。');
      }).then(() => {
        try { worker?.destroy(); } finally { nativeWorker?.terminate(); }
      }).catch(() => console.warn('PDF 线程清理失败。'));
    };
    try {
      if (typeof window !== 'undefined' && 'Worker' in window) {
        nativeWorker = new PdfWorker();
        worker = pdfjsLib.PDFWorker.create({ port: nativeWorker });
      }
      loadingTask = pdfjsLib.getDocument({ ...createPdfDocumentOptions(pdfBytes.slice()), ...(worker ? { worker } : {}) });
    } catch (caught) {
      dispose();
      setPdfState({ status: 'error', document: null, error: caught instanceof Error ? caught.message : String(caught) });
      return () => { cancelled = true; };
    }
    void loadingTask.promise
      .then((document) => {
        if (!cancelled) {
          setPdfState({ status: 'ready', document, error: null });
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setPdfState({
            status: 'error',
            document: null,
            error: caught instanceof Error ? caught.message : String(caught)
          });
        }
      });

    return () => {
      cancelled = true;
      dispose();
    };
  }, [pdfBytes]);

  return pdfState;
}
