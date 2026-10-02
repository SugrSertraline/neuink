import { expect, it } from 'vitest';
import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import { filterEntries } from './libraryEntryFilters';

const statuses = ['Not started', 'Canceled', 'Queued', 'Uploading', 'Parsing', 'Parsed', 'Failed', 'No PDF'] as const;
const entries: LibraryEntry[] = statuses.map((status, index) => ({ id: status, title: `Paper ${index}`, status,
  pdfFileName: status === 'No PDF' ? null : 'paper.pdf', contents: [], tagIds: index ? ['b'] : ['a'], tags: [], fields: {},
  createdAt: '', updatedAt: '', parseMessage: null, parseEndpoint: null, progress: 0 }));
const select = (view: Parameters<typeof filterEntries>[1], tags: Set<string> | null = null, query = '') =>
  filterEntries(entries, view, tags, query, 'title', [], {}).map(e => e.id);

it('includes only unstarted/canceled PDFs and keeps other categories separate', () => {
  expect(select('unparsed')).toEqual(['Not started', 'Canceled']);
  expect(select('parsing')).toEqual(['Queued', 'Uploading', 'Parsing']);
  expect(select('failed')).toEqual(['Failed']);
  expect(select('parsed')).toEqual(['Parsed']);
  expect(select('no_pdf')).toEqual(['No PDF']);
});
it('combines the unparsed category with the existing tag/search filters', () => {
  expect(select('unparsed', new Set(['a']))).toEqual(['Not started']);
  expect(select('unparsed', null, 'Paper 1')).toEqual(['Canceled']);
  expect(select('unparsed', new Set(['a']), 'Paper 1')).toEqual([]);
});
it('updates the category when a PDF is queued or the last unparsed PDF is removed', () => {
  const updated = entries.filter(e => e.status !== 'Canceled').map(e => e.status === 'Not started' ? { ...e, status: 'Queued' as const } : e);
  expect(filterEntries(updated, 'unparsed', null, '', 'title', [], {})).toEqual([]);
});
