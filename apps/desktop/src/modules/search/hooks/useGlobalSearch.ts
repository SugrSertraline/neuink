import { useEffect, useState } from 'react';

import { searchEntries, type SearchMode, type SearchResults } from '@/shared/ipc/workspaceApi';

export function useGlobalSearch({
  root,
  status,
  query,
  mode = 'hybrid',
  limit = 60
}: {
  root: string | null;
  status: 'loading' | 'ready' | 'error';
  query: string;
  mode?: SearchMode;
  limit?: number;
}) {
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!root || status !== 'ready' || trimmedQuery.length < 2) {
      setResults(null);
      setBusy(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setBusy(true);
    setError(null);

    const timer = window.setTimeout(() => {
      void searchEntries(root, trimmedQuery, { limit, mode })
        .then((nextResults) => {
          if (!cancelled) {
            setResults(nextResults);
          }
        })
        .catch((caught) => {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : String(caught));
            setResults(null);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setBusy(false);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [limit, mode, root, status, trimmedQuery]);

  return {
    busy,
    error,
    results
  };
}
