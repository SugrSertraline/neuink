import { expect, it } from 'vitest';

import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { TagMeta } from '@/shared/types/domain';
import { noteCatalogRefreshKey } from './noteCatalogRefreshKey';

const tag: TagMeta = { id: 'tag-1', name: '研究', parent_id: null, created_at: '', updated_at: '' };
const entry: LibraryEntry = {
  id: 'entry-1', title: '论文', tagIds: ['tag-1'], tags: ['研究'], contents: [], fields: {},
  createdAt: '', updatedAt: 'first', pdfFileName: 'paper.pdf', parseMessage: null,
  parseEndpoint: null, status: 'Parsing', progress: 0
};

it('does not rescan notes for parse progress while reacting to actual catalog changes', () => {
  const baseline = noteCatalogRefreshKey([tag], [entry], [], {});
  expect(noteCatalogRefreshKey([tag], [{ ...entry, updatedAt: 'next', progress: 80, parseMessage: '80%' }], [], {}))
    .toBe(baseline);
  expect(noteCatalogRefreshKey([tag], [{ ...entry, status: 'Parsed' }], [], {})).not.toBe(baseline);
  expect(noteCatalogRefreshKey([tag], [{ ...entry, title: '新标题' }], [], {})).not.toBe(baseline);
  expect(noteCatalogRefreshKey([tag], [{ ...entry, contents: [{ kind: 'note', note_id: 'note-1', title: '笔记' }] }], [], {}))
    .not.toBe(baseline);
  expect(noteCatalogRefreshKey([{ ...tag, name: '新标签' }], [entry], [], {})).not.toBe(baseline);
});
