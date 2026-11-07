import { useCallback, useEffect, useMemo, useState } from 'react';

import { readPdfBytes } from '@/shared/ipc/workspaceApi';

export type PdfBytesLoadState =
  | { status: 'idle' | 'loading'; bytes: null; error: null }
  | { status: 'ready'; bytes: Uint8Array; error: null }
  | { status: 'error'; bytes: null; error: string };

export type RetryablePdfBytesLoadState = PdfBytesLoadState & {
  retry: () => void;
};

/**
 * `contentHash` must change whenever the file at `pdfPath` is replaced. The
 * path stays the same across an in-place replacement, so the hash is the only
 * signal that the cached bytes are stale.
 */
export function usePdfBytes(pdfPath: string | null, contentHash?: string | null): RetryablePdfBytesLoadState {
  const [loadState, setLoadState] = useState<PdfBytesLoadState>({
    status: 'idle',
    bytes: null,
    error: null
  });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const retry = useCallback(() => setLoadAttempt((attempt) => attempt + 1), []);

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
  }, [loadAttempt, pdfPath, contentHash]);

  return useMemo(() => ({ ...loadState, retry }), [loadState, retry]);
}
