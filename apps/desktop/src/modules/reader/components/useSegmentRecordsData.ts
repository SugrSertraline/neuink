import { useEffect, useState } from 'react';
import type { PdfReaderResponse } from '@/shared/ipc/workspaceApi';

export function useSegmentRecordsData({ entryId, workspaceRoot, enabled, refreshKey, load }: {
  entryId: string; workspaceRoot: string | null; enabled: boolean; refreshKey: string;
  load: (entryId: string) => Promise<PdfReaderResponse>;
}) {
  const identity = JSON.stringify([workspaceRoot, entryId]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ identity: string; data: PdfReaderResponse | null; loading: boolean; error: string | null }>({ identity, data: null, loading: enabled, error: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState((previous) => ({ identity, data: previous.identity === identity ? previous.data : null, loading: true, error: null }));
    void Promise.resolve().then(() => load(entryId)).then((data) => {
      if (!cancelled) setState({ identity, data, loading: false, error: null });
    }).catch((caught: unknown) => {
      if (!cancelled) setState((previous) => ({ ...previous, loading: false, error: caught instanceof Error ? caught.message : String(caught) }));
    });
    return () => { cancelled = true; };
  }, [identity, entryId, enabled, refreshKey, load, attempt]);
  const current = state.identity === identity ? state : { data: null, loading: enabled, error: null };
  return { ...current, loading: enabled && current.loading, retry: () => setAttempt((value) => value + 1) };
}
