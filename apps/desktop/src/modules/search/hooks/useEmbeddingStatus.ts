import { useEffect, useState } from 'react';

import { getEmbeddingStatus, type EmbeddingProviderStatus } from '@/shared/ipc/workspaceApi';

export function useEmbeddingStatus(enabled = true) {
  const [status, setStatus] = useState<EmbeddingProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    void getEmbeddingStatus()
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
  }, [enabled]);

  return {
    embeddingError: error,
    embeddingStatus: status
  };
}
