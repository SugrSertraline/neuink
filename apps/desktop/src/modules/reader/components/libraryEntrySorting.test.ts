import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import type { EntryReadingState } from '@/shared/types/domain';
import { filterEntries } from './libraryEntryFilters';
import { sortLibraryEntries, type LibraryEntrySortDirection, type LibraryEntrySortKey } from './libraryEntrySorting';

const entry = (id: string, overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id, title: id, contents: [], fields: {}, tags: [], tagIds: [], createdAt: '', updatedAt: '',
  pdfFileName: null, status: 'No PDF', progress: 0, parseMessage: null, parseEndpoint: null, ...overrides
});
const state = (id: string, overrides: Partial<EntryReadingState>): EntryReadingState => ({
  entry_id: id, version: 1, document_hash: null, mode: 'pdf', current_page_idx: 0, page_count: 10,
  visited_pages: [], total_active_ms: 0, session_count: 1, last_read_at: null, daily_active_ms: {}, ...overrides
});
const ids = (entries: LibraryEntry[]) => entries.map(item => item.id);

describe('library column ordering', () => {
  it('uses natural text order, reverses it, and leaves the input untouched', () => {
    const entries = [entry('Paper 10'), entry('Paper 2'), entry('Paper 1')];
    expect(ids(sortLibraryEntries(entries, { by: 'title', direction: 'asc' }, {}, []))).toEqual(['Paper 1', 'Paper 2', 'Paper 10']);
    expect(ids(sortLibraryEntries(entries, { by: 'title', direction: 'desc' }, {}, []))).toEqual(['Paper 10', 'Paper 2', 'Paper 1']);
    expect(ids(entries)).toEqual(['Paper 10', 'Paper 2', 'Paper 1']);
  });

  it.each(['asc', 'desc'] as LibraryEntrySortDirection[])('keeps missing/invalid dates last and ties stable in %s order', direction => {
    const entries = [entry('missing'), entry('older', { updatedAt: '2025-01-01' }), entry('bad', { updatedAt: 'invalid' }),
      entry('newer', { updatedAt: '2026-01-01' }), entry('equal', { updatedAt: '2026-01-01' })];
    expect(ids(sortLibraryEntries(entries, { by: 'updated', direction }, {}, []))).toEqual(
      direction === 'asc' ? ['older', 'newer', 'equal', 'missing', 'bad'] : ['newer', 'equal', 'older', 'missing', 'bad']);
  });

  it.each(['reading-progress', 'reading-time', 'last-read'] as LibraryEntrySortKey[])('sorts %s by numeric values rather than display text', by => {
    const entries = [entry('low'), entry('high'), entry('unread')];
    const states = {
      low: state('low', { visited_pages: [0], total_active_ms: 120_000, last_read_at: '2025-01-01' }),
      high: state('high', { visited_pages: Array.from({ length: 10 }, (_, i) => i), total_active_ms: 600_000, last_read_at: '2026-01-01' })
    };
    expect(ids(sortLibraryEntries(entries, { by, direction: 'desc' }, states, []))).toEqual(['high', 'low', 'unread']);
    expect(ids(sortLibraryEntries(entries, { by, direction: 'asc' }, states, []))).toEqual(
      by === 'last-read' ? ['low', 'high', 'unread'] : ['unread', 'low', 'high']);
  });

  it('sorts source labels from the visible catalog and supports tags, file names, and parse stages', () => {
    const entries = [entry('z', { tags: ['Topic 10'], pdfFileName: 'paper10.pdf', status: 'Parsed' }),
      entry('m', { tags: ['Topic 2'], pdfFileName: 'paper2.pdf', status: 'Not started' }), entry('local')];
    for (const by of ['source', 'tags', 'file'] as const) {
      const result = sortLibraryEntries(entries, { by, direction: 'asc' }, {}, [], { z: ['zotero'], m: ['mineru'], local: [] });
      expect(ids(result)).toEqual(by === 'source' ? ['local', 'm', 'z'] : ['m', 'z', 'local']);
    }
    expect(ids(sortLibraryEntries(entries, { by: 'parser', direction: 'asc' }, {}, []))).toEqual(['local', 'm', 'z']);
  });

  it('keeps the recent view as a filter while allowing explicit ordering', () => {
    const entries = [entry('Alpha'), entry('Beta'), entry('Outside')];
    expect(ids(filterEntries(entries, 'recent', null, '', 'recent', ['Beta', 'Alpha'], {}))).toEqual(['Beta', 'Alpha']);
    expect(ids(filterEntries(entries, 'recent', null, '', 'title', ['Beta', 'Alpha'], {}, { direction: 'asc' }))).toEqual(['Alpha', 'Beta']);
    expect(ids(filterEntries(entries, 'recent', null, '', 'title', ['Beta', 'Alpha'], {}, { direction: 'desc' }))).toEqual(['Beta', 'Alpha']);
  });
});
