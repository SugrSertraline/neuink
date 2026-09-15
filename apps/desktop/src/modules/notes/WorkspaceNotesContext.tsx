import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { NOTES_CHANGED, readNoteCatalog, type NoteCatalog } from '@/shared/ipc/noteCatalogApi';

const EMPTY: NoteCatalog = { notes: [], errors: [] };
type NotesContext = { root: string | null; catalog: NoteCatalog; loading: boolean; error: string | null; refresh: () => void; version: string };
const Context = createContext<NotesContext | null>(null);
export const useWorkspaceNotes = () => useContext(Context);

// Catalog owns query state; each view owns selection/scrolling. Workspace changes cancel old results.
export function WorkspaceNotesProvider({ root, refreshKey, children }: { root: string | null; refreshKey: string; children: ReactNode }) {
  const [result, setResult] = useState<{ root: string | null; catalog: NoteCatalog }>({ root: null, catalog: EMPTY });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === root) refresh(); };
    window.addEventListener(NOTES_CHANGED, changed);
    return () => window.removeEventListener(NOTES_CHANGED, changed);
  }, [root, refresh]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    if (!root) { setLoading(false); return; }
    // Coalesce a save plus its entry metadata refresh into one scan.
    const timer = setTimeout(() => void readNoteCatalog(root).then((catalog) => {
      if (!cancelled) setResult({ root, catalog });
    }).catch((caught) => { if (!cancelled) setError(String(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); }), 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [root, refreshKey, revision]);
  return <Context.Provider value={{ root, catalog: result.root === root ? result.catalog : EMPTY, loading, error, refresh,
    version: `${root}:${refreshKey}:${revision}` }}>{children}</Context.Provider>;
}
