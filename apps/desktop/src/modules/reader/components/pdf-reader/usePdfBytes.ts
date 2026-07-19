import { useEffect, useMemo, useState } from 'react';

import { readPdfBytes } from '@/shared/ipc/workspaceApi';

export type PdfBytesLoadState =
  | { status: 'idle' | 'loading'; bytes: null; error: null }
  | { status: 'ready'; bytes: Uint8Array; error: null }
  | { status: 'error'; bytes: null; error: string };

export function usePdfBytes(pdfPath: string | null): PdfBytesLoadState {
  const [loadState, setLoadState] = useState<PdfBytesLoadState>({
    status: 'idle',
    bytes: null,
    error: null
  });

  useEffect(() => {
    if (!pdfPath) {
      setLoadState({ status: 'idle', bytes: null, error: null });
      return undefined;
    }

    let cancelled = false;
    setLoadState({ status: 'loading', bytes: null, error: null });

    void readPdfBytes(pdfPath)
      .then((bytes) => {
        if (!cancelled) {
          setLoadState({ status: 'ready', bytes: new Uint8Array(bytes), error: null });
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setLoadState({
            status: 'error',
            bytes: null,
            error: caught instanceof Error ? caught.message : String(caught)
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pdfPath]);

  return useMemo(() => loadState, [loadState]);
}
