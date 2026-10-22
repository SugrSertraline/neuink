import { useCallback, useRef } from 'react';

import type { SourceSegment } from '@/shared/types/domain';

export function useGuardedSegmentAction<Args extends unknown[]>(action: (segment: SourceSegment, ...args: Args) => void) {
  const actionRef = useRef(action);
  actionRef.current = action;

  return useCallback((segment: SourceSegment, ...args: Args) => {
    actionRef.current(segment, ...args);
  }, []);
}
