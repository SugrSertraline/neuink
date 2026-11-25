import { useCallback, useEffect, useRef } from 'react';

const RESCAN_INTERVAL_MS = 2 * 60 * 1000;

export function useActiveSourceRefresh(active: boolean, directory: string | null | undefined, busy: boolean, load: () => Promise<void>, reset: () => void) {
  const lastScan = useRef(0);
  const refresh = useCallback(() => {
    lastScan.current = Date.now();
    return load();
  }, [load]);

  useEffect(() => {
    if (!active) return;
    if (directory) void refresh();
    else reset();
  }, [active, directory, refresh, reset]);

  useEffect(() => {
    if (!active || !directory) return;
    const check = () => {
      if (document.visibilityState === 'hidden' || busy || Date.now() - lastScan.current < RESCAN_INTERVAL_MS) return;
      void refresh();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [active, directory, busy, refresh]);
  return refresh;
}
