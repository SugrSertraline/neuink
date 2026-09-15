import { useCallback, useEffect, useRef, useState } from 'react';

export const TAG_EXPANSION_STORAGE_KEY = 'neuink.tagTreeExpansion.v1';

function readExpandedIds(): Set<string> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(TAG_EXPANSION_STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function useTagTreeExpansion(ancestorIds: string[], reveal: boolean) {
  const [expandedIds, setExpandedIds] = useState(readExpandedIds);
  const [persistenceError, setPersistenceError] = useState(false);
  const current = useRef(expandedIds);
  const update = useCallback((getNext: (ids: Set<string>) => Set<string>) => {
    const next = getNext(current.current);
    if (next === current.current) return;
    current.current = next;
    setExpandedIds(next);
    try {
      window.localStorage.setItem(TAG_EXPANSION_STORAGE_KEY, JSON.stringify([...next]));
      setPersistenceError(false);
    } catch {
      setPersistenceError(true);
    }
  }, []);
  const ancestorKey = JSON.stringify(ancestorIds);
  useEffect(() => {
    if (!reveal) return;
    const ids = JSON.parse(ancestorKey) as string[];
    update(currentIds => ids.every(id => currentIds.has(id)) ? currentIds : new Set([...currentIds, ...ids]));
  }, [ancestorKey, reveal, update]);

  const toggle = (id: string) => update(ids => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const collapseAll = () => update(() => new Set());
  return { expandedIds, toggle, collapseAll, persistenceError };
}
