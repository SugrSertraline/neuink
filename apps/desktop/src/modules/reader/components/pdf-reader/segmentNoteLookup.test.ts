import { expect, it } from 'vitest';
import { buildSegmentNoteLookup } from './segmentNoteLookup';
import type { SourceSegment } from '@/shared/types/domain';

it('finds persisted continuation notes by both real uid and logical group', () => {
  const segment: SourceSegment = { uid: 'real', continuation_group_id: 'group', page_idx: 0, segment_type: 'paragraph', text: 'source', markdown: null, bbox: null };
  const note = { segment_uid: 'real', text: 'Saved note', created_at: '', updated_at: '' };
  const orphan = { ...note, segment_uid: 'removed' };
  const lookup = buildSegmentNoteLookup([note, orphan, { ...note, segment_uid: 'empty', text: ' ' }], [segment]);
  expect(lookup.get('group')).toBe(note);
  expect(lookup.get('real')).toBe(note);
  expect(lookup.get('removed')).toBe(orphan);
  expect(lookup.has('empty')).toBe(false);
});
