import { useEffect, useRef } from 'react';
import type { PdfJumpRequest } from '../../types';

/** Commit navigation and acknowledgement in the same frame, after the reader is ready. */
export function usePdfSourceJump({ entryId, request, ready, isHandled, navigate, markHandled }: {
  entryId: string;
  request: PdfJumpRequest | null;
  ready: boolean;
  isHandled?: (key: string) => boolean;
  navigate: (request: PdfJumpRequest) => boolean;
  markHandled?: (key: string, options: { localOnly: boolean }) => void;
}) {
  const callbacks = useRef({ isHandled, navigate, markHandled });
  callbacks.current = { isHandled, navigate, markHandled };
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!request || !ready) return;
    const key = `${entryId}:${request.requestKey}`;
    const frame = requestAnimationFrame(() => {
      const current = callbacks.current;
      if (handled.current === key || current.isHandled?.(key)) return;
      if (!current.navigate(request)) return;
      handled.current = key;
      current.markHandled?.(key, { localOnly: Boolean(request.targetSurfaceKey) });
    });
    return () => cancelAnimationFrame(frame);
  }, [entryId, request, ready]);
}
