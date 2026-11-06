import type { EntryReadingState } from '@/shared/types/domain';
import type { LibraryEntry, LibraryEntryStatus } from '../../library/components/LibrarySidebar';
import type { EntryLibraryColumnId } from './useEntryLibraryColumnWidths';
import { getReadingProgress } from './libraryReading';

export type LibraryEntrySortKey = Exclude<EntryLibraryColumnId, 'actions'> | 'created' | 'recent';
export type LibraryEntrySortDirection = 'asc' | 'desc';
export type LibraryEntrySort = { by: LibraryEntrySortKey; direction: LibraryEntrySortDirection };
export type LibraryEntrySourceKinds = Record<string, ('zotero' | 'mineru')[]>;

const textOrder = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const parserOrder: Record<LibraryEntryStatus, number> = {
  'No PDF': 0, 'Not started': 1, Queued: 2, Uploading: 3, Parsing: 4, Parsed: 5, Failed: 6, Canceled: 7
};

export function defaultLibrarySortDirection(by: LibraryEntrySortKey): LibraryEntrySortDirection {
  return ['title', 'source', 'tags', 'file', 'parser'].includes(by) ? 'asc' : 'desc';
}

export function nextLibraryEntrySort(by: LibraryEntrySortKey, current?: LibraryEntrySort): LibraryEntrySort {
  return { by, direction: current?.by === by
    ? current.direction === 'asc' ? 'desc' : 'asc'
    : defaultLibrarySortDirection(by) };
}

export function libraryEntrySourceLabel(kinds?: readonly ('zotero' | 'mineru')[]) {
  return kinds?.map(kind => kind === 'zotero' ? 'Zotero' : 'MinerU').join(' · ') || '本地';
}

function timestamp(value?: string | null) {
  const result = value ? Date.parse(value) : NaN;
  return Number.isFinite(result) ? result : null;
}

export function sortLibraryEntries(
  entries: readonly LibraryEntry[],
  sort: LibraryEntrySort,
  readingStates: Record<string, EntryReadingState>,
  recentReadingEntryIds: readonly string[],
  sourceKindsByEntry?: LibraryEntrySourceKinds
) {
  const recentOrder = new Map(recentReadingEntryIds.map((id, index) => [id, -index]));
  const value = (entry: LibraryEntry): string | number | null => {
    const state = readingStates[entry.id];
    switch (sort.by) {
      case 'title': return entry.title.trim() || null;
      case 'source': return libraryEntrySourceLabel(sourceKindsByEntry?.[entry.id] ?? entry.sourceInfo?.kinds);
      case 'tags': return entry.tags.join(' · ') || null;
      case 'file': return entry.pdfFileName?.trim() || null;
      case 'parser': return parserOrder[entry.status];
      case 'reading-progress': return getReadingProgress(state);
      case 'last-read': return timestamp(state?.last_read_at);
      case 'reading-time': return state?.total_active_ms ?? 0;
      case 'created': return timestamp(entry.createdAt);
      case 'updated': return timestamp(entry.updatedAt);
      case 'recent': return recentOrder.get(entry.id) ?? null;
    }
  };
  // Calculate display values once; keep missing values last in either direction.
  return entries.map(entry => ({ entry, value: value(entry) })).sort((left, right) => {
    if (left.value === null) return right.value === null ? 0 : 1;
    if (right.value === null) return -1;
    const order = typeof left.value === 'number' && typeof right.value === 'number'
      ? left.value - right.value : textOrder.compare(String(left.value), String(right.value));
    return sort.direction === 'asc' ? order : -order;
  }).map(item => item.entry);
}
