// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import type { NoteDocument } from '@/shared/types/domain';
import { useSourceBacklinks } from './useSourceBacklinks';

const entries: LibraryEntry[] = [{
  id: 'notes',
  contents: [{ kind: 'note', note_id: 'note-1', title: 'Note' }],
  title: 'Notes entry',
  tagIds: [], tags: [], fields: {}, createdAt: '', updatedAt: '', pdfFileName: null,
  parseMessage: null, parseEndpoint: null, status: 'Parsed', progress: 100
}];

const note: NoteDocument = {
  note_id: 'note-1',
  title: 'Note',
  markdown: '',
  links: [{
    link_id: 'link-1', anchor_id: 'anchor-1', display_text: 'Source', created_at: '',
    owner: { kind: 'note', entry_id: 'notes', note_id: 'note-1' },
    sources: [{ entry_id: 'source', segment_uid: 'segment-1', page: 0, snapshot_text: '', quote_hash: '' }]
  }]
};

describe('useSourceBacklinks', () => {
  it('only re-reads notes whose refresh revision changed', async () => {
    const readMarkdownNote = vi.fn().mockResolvedValue(note);
    const { result, rerender } = renderHook(
      ({ revisions }) => useSourceBacklinks(entries, revisions, readMarkdownNote),
      { initialProps: { revisions: {} as Record<string, number> } }
    );

    await waitFor(() => expect(result.current.source?.['segment-1']).toHaveLength(1));
    expect(readMarkdownNote).toHaveBeenCalledTimes(1);

    rerender({ revisions: {} });
    await waitFor(() => expect(result.current.source?.['segment-1']).toHaveLength(1));
    expect(readMarkdownNote).toHaveBeenCalledTimes(1);

    rerender({ revisions: { 'notes:note-1': 1 } });
    await waitFor(() => expect(readMarkdownNote).toHaveBeenCalledTimes(2));
  });
});
