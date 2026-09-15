import { describe, expect, it } from 'vitest';
import type { CatalogNote } from '@/shared/ipc/noteCatalogApi';
import type { SourceLink } from '@/shared/types/domain';
import { tagNotesForScope } from './TagNotesList';
import { catalogBacklinks } from '@/modules/reader/components/useSourceBacklinks';
import { noteSurface, surfaceNoteTarget, surfaceKey } from '@/app/workspaceSurface';

const row = (id: string, papers: string[], tag = 'T'): CatalogNote => ({ target: { owner: { kind: 'tag_reading', tag_id: tag }, note_id: id }, title: id,
  owner_title: tag, revision: '1', updated_at: '', deleted_at: null, error: null,
  links: papers.map((entry_id) => ({ link_id: `${id}-${entry_id}`, anchor_id: `sl-${id}-${entry_id}`, display_text: '引用',
    sources: [{ entry_id, segment_uid: 'segment', page: 1, snapshot_text: '原始证据' }] } as SourceLink)) });
const notes = [row('N1', ['A', 'B']), row('N2', ['B', 'C']), row('N3', []), row('N4', ['A'], 'Other')];
describe('tag note ownership and evidence scope', () => {
  it('shows every owned note in a tag, including ideas without evidence', () => {
    expect(tagNotesForScope(notes, 'T', 'A').map((note) => note.title)).toEqual(['N1', 'N2', 'N3']);
    expect(tagNotesForScope(notes, 'T', 'A', true).map((note) => note.title)).toEqual(['N1']);
    expect(tagNotesForScope(notes, 'T', 'B', true).map((note) => note.title)).toEqual(['N1', 'N2']);
    expect(tagNotesForScope(notes, null, 'A').map((note) => note.title)).toEqual(['N1', 'N4']);
  });
  it('reverse lookup uses the real tag owner and ignores deleted or unreadable notes', () => {
    const backlinks = catalogBacklinks([...notes, { ...row('deleted', ['A']), deleted_at: 'now' }, { ...row('broken', ['A']), error: '损坏' }]);
    expect(backlinks.A.segment).toHaveLength(2);
    expect(backlinks.A.segment[0].noteEntryId).toBeNull();
    const target = backlinks.A.segment[0].noteTarget!;
    const surface = noteSurface(target);
    expect(surfaceNoteTarget(surface)).toEqual({ owner: { kind: 'tag_reading', tag_id: 'T' }, note_id: 'N1' });
    expect(surfaceKey(surface)).toBe('note:tag-reading:T:N1');
  });
});
