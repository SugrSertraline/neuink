import type { EntryReadingState, TagMeta } from '@/shared/types/domain';
import type { LibraryEntry, LibraryView } from '../../library/components/LibrarySidebar';
import { getReadingProgress, getReadingTimestamp } from './libraryReading';

export function buildTagBreadcrumb(tags: TagMeta[], activeTag: string | null) {
  if (!activeTag) {
    return [];
  }
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const breadcrumb: Array<{ id: string; name: string }> = [];
  const visited = new Set<string>();
  let current = tagById.get(activeTag);

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    breadcrumb.unshift({ id: current.id, name: current.name });
    current = current.parent_id ? tagById.get(current.parent_id) : undefined;
  }
  return breadcrumb;
}

export function filterEntries(
  entries: LibraryEntry[],
  libraryView: LibraryView,
  activeTagIds: Set<string> | null,
  query: string,
  sortBy: string,
  recentReadingEntryIds: string[],
  readingStates: Record<string, EntryReadingState>
) {
  const entriesInView = entries.filter((item) => {
    if (libraryView === 'recent') {
      return recentReadingEntryIds.includes(item.id);
    }
    if (libraryView === 'parsed') {
      return item.status === 'Parsed';
    }
    if (libraryView === 'parsing') {
      return ['Queued', 'Uploading', 'Parsing'].includes(item.status);
    }
    if (libraryView === 'failed') {
      return item.status === 'Failed';
    }
    if (libraryView === 'no_pdf') {
      return item.status === 'No PDF';
    }
    return true;
  });
  const entriesInTag = activeTagIds
    ? entriesInView.filter((item) => item.tagIds.some((tagId) => activeTagIds.has(tagId)))
    : entriesInView;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? entriesInTag.filter((item) => {
        const fieldText = Object.entries(item.fields)
          .flatMap(([key, value]) => [key, value])
          .join(' ');
        const haystack = [item.title, item.status, item.pdfFileName ?? '', fieldText, ...item.tags]
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : entriesInTag;

  return [...filtered].sort((left, right) => {
    if (libraryView === 'recent') {
      return recentReadingEntryIds.indexOf(left.id) - recentReadingEntryIds.indexOf(right.id);
    }
    if (sortBy === 'title') {
      return left.title.localeCompare(right.title);
    }
    if (sortBy === 'parser') {
      return left.status.localeCompare(right.status);
    }
    if (sortBy === 'reading-progress') {
      return getReadingProgress(readingStates[right.id]) - getReadingProgress(readingStates[left.id]);
    }
    if (sortBy === 'last-read') {
      return getReadingTimestamp(readingStates[right.id]) - getReadingTimestamp(readingStates[left.id]);
    }
    if (sortBy === 'reading-time') {
      return (readingStates[right.id]?.total_active_ms ?? 0) - (readingStates[left.id]?.total_active_ms ?? 0);
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}
