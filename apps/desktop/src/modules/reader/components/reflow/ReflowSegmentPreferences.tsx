import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { normalizeReflowContent, type ReflowContentOverrides } from '@/shared/lib/reflowContentPreferences';

type Overrides = Record<string, ReflowContentOverrides>;
type ContextValue = { overrides: Overrides; update: (uid: string, patch: ReflowContentOverrides | null) => void };
const Context = createContext<ContextValue>({ overrides: {}, update: () => {} });
const CHANGE_EVENT = 'neuink:reflow-segment-content';

function read(key: string): Overrides {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([uid, raw]) => {
      const content = normalizeReflowContent(raw);
      return Object.keys(content).length ? [[uid, content]] : [];
    }));
  } catch { return {}; }
}

/** The session owns overrides so virtualization cannot discard a segment's choice. */
export function ReflowSegmentPreferencesProvider({ root, entryId, children }: { root: string | null; entryId: string; children: ReactNode }) {
  const storageKey = `neuink.reflow.segment-content:${JSON.stringify([root, entryId])}`;
  return <Session key={storageKey} storageKey={storageKey}>{children}</Session>;
}

function Session({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const [overrides, setOverrides] = useState(() => read(storageKey));
  useEffect(() => {
    const sync = (event: Event) => {
      if (event instanceof StorageEvent ? event.key === storageKey || event.key === null : (event as CustomEvent).detail === storageKey) setOverrides(read(storageKey));
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(CHANGE_EVENT, sync); window.removeEventListener('storage', sync); };
  }, [storageKey]);
  return <Context.Provider value={{ overrides, update: (uid, patch) => {
    const next = { ...overrides, ...read(storageKey) };
    if (patch === null) delete next[uid];
    else next[uid] = { ...next[uid], ...patch };
    setOverrides(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: storageKey }));
    } catch { /* Keep the choice usable in this session when storage is unavailable. */ }
  } }}>{children}</Context.Provider>;
}

export function useReflowSegmentPreferences(uid: string) {
  const { overrides, update } = useContext(Context);
  return { override: overrides[uid], update: (patch: ReflowContentOverrides | null) => update(uid, patch) };
}
