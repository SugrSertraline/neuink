import { useCallback, useEffect, useState } from 'react';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { listIdeationDrafts, type IdeationDraftSummary, type IdeationState } from '@/shared/ipc/ideationApi';

/** Read-only catalog. Card generation is exclusively a user-triggered action. */
export function useIdeationBackground(root: string, _entries: LibraryEntry[], _state: IdeationState | null, _libraryReady: boolean, available = true) {
  const [summaries, setSummaries] = useState<IdeationDraftSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setSummaries(await listIdeationDrafts(root)); setError(null); }
    catch { setError('卡片记录读取失败，请重试。'); }
  }, [root]);
  useEffect(() => {
    let live = true;
    if (!available) { setSummaries([]); return; }
    void listIdeationDrafts(root).then(records => { if (live) setSummaries(records); })
      .catch(() => { if (live) setError('卡片记录读取失败，请重试。'); });
    return () => { live = false; };
  }, [available, root]);
  return { summaries, error, refresh, activeId: null, progress: null };
}
