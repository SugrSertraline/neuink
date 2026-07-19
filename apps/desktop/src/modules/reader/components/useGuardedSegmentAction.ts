import { useCallback, useEffect, useRef } from 'react';

import type { SourceSegment } from '@/shared/types/domain';

const SEGMENT_ACTION_DEBOUNCE_MS = 240;

export function useGuardedSegmentAction(action: (segment: SourceSegment) => void) {
  const actionRef = useRef(action);
  const frameRef = useRef<number | null>(null);
  const lastActionRef = useRef<{ at: number; uid: string } | null>(null);
  const pendingRef = useRef<SourceSegment | null>(null);
  actionRef.current = action;

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  return useCallback((segment: SourceSegment) => {
    const now = performance.now();
    const lastAction = lastActionRef.current;
    if (lastAction?.uid === segment.uid && now - lastAction.at < SEGMENT_ACTION_DEBOUNCE_MS) return;

    pendingRef.current = segment;
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending) return;
      lastActionRef.current = { at: performance.now(), uid: pending.uid };
      actionRef.current(pending);
    });
  }, []);
}
