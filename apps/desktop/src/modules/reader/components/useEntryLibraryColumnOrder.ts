import { useEffect, useState } from 'react';
import { workspaceStorageIdentity } from '@/shared/lib/workspaceStorageIdentity';
import type { EntryLibraryColumnId } from './useEntryLibraryColumnWidths';

const STORAGE_PREFIX = 'neuink.entryLibraryColumnOrder.v1:';
const ORDER_EVENT = 'neuink-entry-library-column-order-changed';
/** Field IDs carry a workspace path; persist the field name so portable profiles can move. */
export function orderKey(id: EntryLibraryColumnId): string {
  if (!id.startsWith('field:')) return id;
  const parts = id.slice(6).split(':');
  return `property:${parts.length > 1 ? parts.slice(1).join(':') : parts[0]}`;
}
function storageKey(root?: string | null) { return STORAGE_PREFIX + (root ? workspaceStorageIdentity(root) : 'default'); }
function readOrder(key: string): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length <= 1024 && item !== 'title' && item !== 'actions'))].slice(0, 512) : [];
  } catch { return []; }
}
export function resolveColumnOrder<T extends { id: EntryLibraryColumnId }>(columns: readonly T[], saved: readonly string[]): T[] {
  const middle = columns.filter(column => column.id !== 'title' && column.id !== 'actions');
  const byKey = new Map(middle.map(column => [orderKey(column.id), column]));
  const ordered = saved.flatMap(key => { const column = byKey.get(key); if (!column) return []; byKey.delete(key); return [column]; });
  return [...columns.filter(column => column.id === 'title'), ...ordered, ...middle.filter(column => byKey.has(orderKey(column.id))), ...columns.filter(column => column.id === 'actions')];
}
export function moveColumnOrder(saved: readonly string[], current: readonly string[], source: string, target: string, after: boolean): string[] {
  if (source === target || !current.includes(source) || !current.includes(target)) return [...saved];
  const all = [...new Set([...saved, ...current])].filter(key => key !== source && key !== 'title' && key !== 'actions');
  const index = all.indexOf(target);
  if (index < 0) return [...saved];
  all.splice(index + (after ? 1 : 0), 0, source);
  return all;
}
export function useEntryLibraryColumnOrder(root: string | null | undefined, middle: readonly EntryLibraryColumnId[]) {
  const key = storageKey(root);
  const [state, setState] = useState(() => ({ key, order: readOrder(key) }));
  useEffect(() => {
    setState(current => current.key === key ? current : { key, order: readOrder(key) });
    const update = (event: Event) => { const detail = (event as CustomEvent<{ key: string; order: string[] }>).detail; if (detail?.key === key) setState({ key, order: detail.order }); };
    window.addEventListener(ORDER_EVENT, update);
    return () => window.removeEventListener(ORDER_EVENT, update);
  }, [key]);
  const order = state.key === key ? state.order : readOrder(key);
  const move = (source: EntryLibraryColumnId, target: EntryLibraryColumnId, after: boolean) => {
    if (source === 'title' || source === 'actions' || target === 'title' || target === 'actions') return;
    const next = moveColumnOrder(order, middle.map(orderKey), orderKey(source), orderKey(target), after);
    setState({ key, order: next });
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* Keep this session usable. */ }
    window.dispatchEvent(new CustomEvent(ORDER_EVENT, { detail: { key, order: next } }));
  };
  return { order, move };
}
