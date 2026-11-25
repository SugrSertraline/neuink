import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceSegment } from '@/shared/types/domain';

export const isVisualSegment = (segment: SourceSegment) =>
  (segment.segment_type === 'figure' || segment.segment_type === 'table') &&
  segment.block_role !== 'caption' && segment.block_role !== 'footnote';

/** Page-local transient UI; no reading position or workspace data is changed. */
export function usePdfVisualDetail(pdf: PDFDocumentProxy, entryId: string, workspaceRoot: string | null, disabled: boolean) {
  const [segment, setSegment] = useState<SourceSegment | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopWatching = useRef<(() => void) | null>(null);
  const clickCandidate = useRef<string | null>(null);
  const cancelClick = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    clickCandidate.current = null;
    stopWatching.current?.();
    stopWatching.current = null;
  }, []);
  const close = useCallback(() => { cancelClick(); setSegment(null); }, [cancelClick]);
  useEffect(() => {
    close();
    return cancelClick;
  }, [pdf, entryId, workspaceRoot, close, cancelClick]);
  useEffect(() => { if (disabled) cancelClick(); }, [disabled, cancelClick]);
  useEffect(() => {
    if (!segment) return;
    window.addEventListener('neuink:reader-surface-change', close);
    return () => window.removeEventListener('neuink:reader-surface-change', close);
  }, [segment, close]);
  return { segment, close, cancelClick, clickCandidate,
    open: (next: SourceSegment) => { cancelClick(); if (!disabled && isVisualSegment(next)) setSegment(next); },
    deferClick: (action: () => void) => {
      if (timer.current !== null) clearTimeout(timer.current);
      stopWatching.current?.();
      // Only the pending gesture subscribes; hundreds of PDF pages must not add scroll listeners.
      const events = ['blur', 'scroll', 'pointerdown', 'keydown', 'neuink:reader-surface-change'];
      events.forEach(event => window.addEventListener(event, cancelClick, true));
      stopWatching.current = () => events.forEach(event => window.removeEventListener(event, cancelClick, true));
      // Leave the native double-click window free of note popovers and layout changes.
      timer.current = setTimeout(() => { cancelClick(); action(); }, 500);
    },
  };
}
