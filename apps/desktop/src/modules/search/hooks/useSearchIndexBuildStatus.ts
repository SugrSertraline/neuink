import { useEffect, useState } from 'react';

import {
  getSearchIndexBuildStatus,
  type SearchIndexBuildStatus
} from '@/shared/ipc/workspaceApi';

const SEARCH_BUILD_POLL_INTERVAL_MS = 900;

export function useSearchIndexBuildStatus({
  enabled = true,
  root
}: {
  enabled?: boolean;
  root: string | null;
}) {
  const [status, setStatus] = useState<SearchIndexBuildStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !root) {
      setStatus(null);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    let requestRunning = false;
    const refresh = async () => {
      if (requestRunning) return;
      requestRunning = true;
      try {
        const next = await getSearchIndexBuildStatus(root);
        if (!cancelled) {
          setStatus(next);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        requestRunning = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), SEARCH_BUILD_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, root]);

  return {
    searchIndexBuildError: error,
    searchIndexBuildStatus: status
  };
}
