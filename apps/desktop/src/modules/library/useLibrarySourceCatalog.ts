import { useEffect, useRef, useState } from 'react';
import { listEntrySources, setEntrySourceHidden, type EntrySourceInfo } from '@/shared/ipc/workspaceApi';
import type { EntryMeta } from '@/shared/types/domain';

export type LibrarySourceCatalog = {
  sources: Record<string, EntrySourceInfo>;
  loading: boolean;
  error: boolean;
  reload?: () => void;
  setHidden: (entryId: string, hidden: boolean) => Promise<void>;
};

export function useLibrarySourceCatalog(root: string | null, entries: readonly EntryMeta[]): LibrarySourceCatalog {
  const [sources, setSources] = useState<Record<string, EntrySourceInfo>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reloadId, setReloadId] = useState(0);
  const activeRoot = useRef(root); activeRoot.current = root;
  const catalogRoot = useRef(root);
  const completedMutation = useRef(0);
  const overrides = useRef(new Map<string, { revision: number; hidden: boolean }>());
  useEffect(() => {
    if (catalogRoot.current !== root) {
      catalogRoot.current = root; overrides.current.clear(); completedMutation.current = 0; setSources({}); setError(false);
    }
    if (!root) { setSources({}); setLoading(false); return; }
    let cancelled = false;
    const readRevision = completedMutation.current;
    setLoading(true);
    void listEntrySources(root).then(next => {
      if (!cancelled) {
        const merged = { ...next };
        for (const [entryId, override] of overrides.current) {
          if (override.revision > readRevision && merged[entryId]) merged[entryId] = { ...merged[entryId], hidden: override.hidden, zotero_hidden: merged[entryId].kinds.includes('zotero') && override.hidden };
        }
        setSources(merged); setError(false);
      }
    }).catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root, entries, reloadId]);
  return {
    sources, loading, error,
    reload: () => setReloadId(value => value + 1),
    setHidden: async (entryId, hidden) => {
      if (!root) throw new Error('资料库未打开。');
      await setEntrySourceHidden(root, entryId, hidden);
      if (activeRoot.current !== root) return;
      overrides.current.set(entryId, { revision: ++completedMutation.current, hidden });
      setSources(previous => ({ ...previous, [entryId]: { ...previous[entryId], hidden, zotero_hidden: Boolean(previous[entryId]?.kinds.includes('zotero') && hidden) } }));
    },
  };
}
