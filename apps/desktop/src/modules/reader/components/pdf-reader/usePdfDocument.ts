import { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

import { createPdfDocumentOptions } from './pdfDocumentOptions';

if (typeof window !== 'undefined' && 'Worker' in window) {
  pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
}

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
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null =
      pdfjsLib.getDocument(createPdfDocumentOptions(pdfBytes));

    setPdfState({ status: 'loading', document: null, error: null });

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
      void loadingTask?.destroy();
      loadingTask = null;
    };
  }, [pdfBytes]);

  return pdfState;
}
