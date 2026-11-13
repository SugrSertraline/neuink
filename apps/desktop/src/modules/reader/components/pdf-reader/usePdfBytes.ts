import { useCallback, useEffect, useMemo, useState } from 'react';

import { readPdfBytes } from '@/shared/ipc/workspaceApi';

// Share only pending reads: completed bytes are owned by mounted readers, never a global cache.
const pendingReads = new Map<string, Promise<ArrayBuffer>>();
function readSharedPdfBytes(path: string, hash?: string | null) {
  const key = JSON.stringify([path, hash ?? null]);
  const existing = pendingReads.get(key);
  if (existing) return existing;
  const request = readPdfBytes(path).finally(() => {
    if (pendingReads.get(key) === request) pendingReads.delete(key);
  });
  pendingReads.set(key, request);
  return request;
}

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

    void readSharedPdfBytes(pdfPath, contentHash)
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
