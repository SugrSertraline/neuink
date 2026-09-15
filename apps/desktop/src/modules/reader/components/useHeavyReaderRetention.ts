import { useEffect, useRef, useState } from 'react';
import { surfaceKey, type WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { hasUnsavedSegmentEditors } from './segmentEditorDirtyRegistry';
import { hasHeavyReaderIdleExpired, HEAVY_READER_SWEEP_INTERVAL_MS, isHeavyReaderSurface } from './readerRetention';

export function useHeavyReaderRetention(layout: WorkspaceSurfaceLayout) {
  const inactiveSince = useRef(new Map<string, number>());
  const [expiredKeys, setExpiredKeys] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const sweep = () => {
      const now = Date.now();
      const activeKeys = new Set([surfaceKey(layout.left), layout.right ? surfaceKey(layout.right) : '']);
      const heavyKeys = new Set([...layout.leftTabs, ...layout.rightTabs].filter(isHeavyReaderSurface).map(surfaceKey));
      for (const key of inactiveSince.current.keys()) {
        if (!heavyKeys.has(key) || activeKeys.has(key) || hasUnsavedSegmentEditors(key)) inactiveSince.current.delete(key);
      }
      for (const key of heavyKeys) {
        if (!activeKeys.has(key) && !hasUnsavedSegmentEditors(key) && !inactiveSince.current.has(key)) inactiveSince.current.set(key, now);
      }
      const next = new Set([...inactiveSince.current].filter(([, start]) => hasHeavyReaderIdleExpired(start, now)).map(([key]) => key));
      setExpiredKeys((current) => current.size === next.size && [...current].every((key) => next.has(key)) ? current : next);
    };
    sweep();
    const timer = window.setInterval(sweep, HEAVY_READER_SWEEP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [layout]);
  return expiredKeys;
}
