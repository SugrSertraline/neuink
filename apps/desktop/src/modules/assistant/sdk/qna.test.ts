import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readNote } from '@/shared/ipc/workspaceApi';
import type { AssistantContext } from '@/shared/types/assistant';

import { buildSelectedMarkdownContext, uniqueContextDocumentItems } from './qna';

vi.mock('@/shared/ipc/workspaceApi', () => ({ readNote: vi.fn() }));

describe('buildSelectedMarkdownContext', () => {
  beforeEach(() => vi.mocked(readNote).mockReset());

  it('reads multiple selected Markdown notes and restores their source markers', async () => {
    vi.mocked(readNote).mockImplementation(async (_root, _entryId, noteId) => ({
      links: noteId === 'note-1' ? [{
        anchor_id: 'sl-1', created_at: '', display_text: 'p.2', link_id: 'link-1',
        owner: { entry_id: 'entry-1', kind: 'note', note_id: 'note-1' },
        sources: [{
          entry_id: 'paper-entry', page: 2, quote_hash: '', segment_uid: 'segment-1',
          snapshot_text: 'Grounded source'
        }]
      }] : [],
      markdown: noteId === 'note-1' ? 'Claim [^sl-1]' : 'Second note body',
      note_id: noteId,
      title: noteId
    }));

    const result = await buildSelectedMarkdownContext({
      assistantContext: contextWithNotes('note-1', 'note-2'),
      markerStart: 3,
      root: 'workspace'
    });

    expect(readNote).toHaveBeenCalledTimes(2);
    expect(result.text).toContain('Claim [S3]');
    expect(result.text).toContain('Second note body');
    expect(result.sourceByMarker.get(3)?.segment_uid).toBe('segment-1');
  });
});

describe('uniqueContextDocumentItems', () => {
  it('hydrates one parsed document when Overall and PDF select the same Entry', () => {
    const items: AssistantContext['items'] = [
      {
        addedAt: '', entryId: 'entry-1', entryTitle: 'Entry',
        id: 'entry:entry-1', kind: 'entry'
      },
      {
        addedAt: '', contentId: 'pdf', contentKind: 'pdf', contentTitle: 'PDF',
        entryId: 'entry-1', entryTitle: 'Entry', id: 'entry:entry-1:pdf:pdf', kind: 'entry'
      },
      {
        addedAt: '', contentId: 'pdf', contentKind: 'pdf', contentTitle: 'PDF',
        entryId: 'entry-2', entryTitle: 'Other', id: 'entry:entry-2:pdf:pdf', kind: 'entry'
      }
    ];

    expect(uniqueContextDocumentItems(items).map((item) => item.entryId))
      .toEqual(['entry-1', 'entry-2']);
  });
});

function contextWithNotes(...noteIds: string[]): AssistantContext {
  return {
    items: noteIds.map((noteId) => ({
      addedAt: '', contentId: noteId, contentKind: 'note' as const, contentTitle: noteId,
      entryId: 'entry-1', entryTitle: 'Entry', id: `entry:entry-1:note:${noteId}`,
      kind: 'entry' as const
    }))
  };
}
