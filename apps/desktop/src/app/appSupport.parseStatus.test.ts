import { expect, it } from 'vitest';
import { toLibraryEntry } from './appSupport';
import type { EntryMeta } from '@/shared/types/domain';

it('does not present downloaded, unparsed PDFs as queued or invent percentage progress', () => {
  const entry = { id: 'one', title: 'Downloaded PDF', contents: [], tags: [], fields: {}, pdf: { file_name: 'paper.pdf', parse: { status: 'not_started' } } } as unknown as EntryMeta;
  expect(toLibraryEntry(entry, new Map()).status).toBe('Not started');
  entry.pdf!.parse.status = 'queued';
  expect(toLibraryEntry(entry, new Map()).status).toBe('Queued');
  expect(toLibraryEntry(entry, new Map()).progress).toBe(0);
});
