import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

export type LibraryPaperSelection = {
  enabled: boolean; ids: ReadonlySet<string>; all: boolean; some: boolean;
  toggle: (id: string, range?: boolean) => void; toggleAll: () => void;
};

export function useLibrarySelection(context: string, filter: string, entries: LibraryEntry[]) {
  const [state, setState] = useState({ context, filter, enabled: false, ids: new Set<string>() });
  const anchor = useRef<string | null>(null);
  const available = useMemo(() => new Set(entries.map(entry => entry.id)), [entries]);
  const enabled = state.context === context && state.enabled;
  const ids = useMemo(() => new Set(state.context === context && state.filter === filter ? [...state.ids].filter(id => available.has(id)) : []), [state, context, filter, available]);
  useEffect(() => {
    anchor.current = null;
    setState(current => ({ context, filter, enabled: current.context === context && current.enabled, ids: new Set() }));
  }, [context, filter]);
  useEffect(() => {
    setState(current => {
      const next = new Set([...current.ids].filter(id => available.has(id)));
      return next.size === current.ids.size ? current : { ...current, ids: next };
    });
  }, [available]);
  const update = (next: Set<string>, active = true) => setState({ context, filter, enabled: active, ids: next });
  const toggle = (id: string, range = false) => {
    if (!available.has(id)) return;
    const next = new Set(ids);
    const start = entries.findIndex(entry => entry.id === anchor.current), end = entries.findIndex(entry => entry.id === id);
    if (range && start >= 0) for (const entry of entries.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(entry.id);
    else { if (next.has(id)) next.delete(id); else next.add(id); anchor.current = id; }
    update(next);
  };
  const all = entries.length > 0 && ids.size === entries.length;
  const toggleAll = () => { anchor.current = null; update(all ? new Set() : new Set(available)); };
  const exit = () => { anchor.current = null; update(new Set(), false); };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!enabled || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
    if ((event.target as Element).closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="menu"], [role="dialog"]')) return;
    // Existing resize and drag controllers own Escape while a pointer gesture is active.
    if (document.body.style.cursor === 'col-resize' || document.body.style.cursor === 'grabbing') return;
    if (event.key === 'Escape') { event.preventDefault(); exit(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); update(new Set(available)); }
  };
  return { enabled, ids, all, some: ids.size > 0 && !all, toggle, toggleAll, onKeyDown, exit,
    enter: () => update(new Set()), clear: () => update(new Set()),
    ensureSelected: (id: string) => { if (enabled && available.has(id) && !ids.has(id)) update(new Set([...ids, id])); },
    remove: (removed: string[]) => setState(current => ({ ...current, ids: new Set([...current.ids].filter(id => !removed.includes(id))) })),
  };
}
