import { useEffect, useState } from 'react';

import {
  getSearchIndexStatus,
  type SearchIndexStatus
} from '@/shared/ipc/workspaceApi';

export function useSearchIndexStatus({
  enabled = true,
  refreshKey,
  root,
  segmentsOnly = false
}: {
  enabled?: boolean;
  refreshKey?: string | number | null;
  root: string | null;
  segmentsOnly?: boolean;
}) {
  const [status, setStatus] = useState<SearchIndexStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !root) {
      setStatus(null);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    void getSearchIndexStatus(root, { segmentsOnly })
      .then((nextStatus) => {
        if (!cancelled) {
          setStatus(nextStatus);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setStatus(null);
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey, root, segmentsOnly]);

  return {
    setSearchIndexStatus: setStatus,
    searchIndexError: error,
    setSearchIndexError: setError,
    searchIndexStatus: status
  };
}
