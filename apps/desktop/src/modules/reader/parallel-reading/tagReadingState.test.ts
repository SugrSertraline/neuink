import { describe, expect, it } from 'vitest';
import type { TagReadingMember, TagReadingState } from '@/shared/ipc/tagReadingApi';
import { finishAndContinue, markMember, moveReadingMember, orderedMembers, reconcileTagReading, selectReadingEntry, tagReadingProgress } from './tagReadingState';

export const emptyTagState = (): TagReadingState => ({ version: 1, revision: 0, tag_id: 'tag', include_descendants: true, active_entry_id: null, compare_entry_id: null, queue_collapsed: false, split_ratio: 0.5, member_states: {}, updated_at: '2026-09-06' });
export const member = (id: string, readable = true): TagReadingMember => ({ entry_id: id, title: id, pdf_available: readable, reflow_available: readable, preferred_mode: 'pdf', issue: null });

describe('tag reading state', () => {
  it('starts one paper without inventing a comparison and keeps removed history', () => {
    const state = reconcileTagReading(emptyTagState(), [member('a'), member('b')], true);
    expect(state.active_entry_id).toBe('a'); expect(state.compare_entry_id).toBeNull();
    const next = reconcileTagReading(markMember(state, 'a', 'done'), [member('b'), member('c')], true);
    expect(next.active_entry_id).toBe('b'); expect(next.member_states.a.status).toBe('done');
    expect(next.member_states.c.order).toBe(2);
  });
  it('keeps fixed comparison while advancing and swaps explicit selection of it', () => {
    const members = [member('a'), member('b'), member('c')];
    const state = { ...reconcileTagReading(emptyTagState(), members, true), compare_entry_id: 'b' };
    const next = finishAndContinue(state, members);
    expect(next.active_entry_id).toBe('c'); expect(next.compare_entry_id).toBe('b');
    expect(selectReadingEntry(next, 'b')).toMatchObject({ active_entry_id: 'b', compare_entry_id: 'c' });
    expect(finishAndContinue(next, members).active_entry_id).toBe('c');
  });
  it('only counts current readable members and excludes skipped tasks', () => {
    const members = [member('a'), member('b'), member('missing', false)];
    let state = reconcileTagReading(emptyTagState(), members, true);
    state = markMember(markMember(markMember(state, 'a', 'done'), 'b', 'skipped'), 'missing', 'done');
    expect(tagReadingProgress(state, members)).toEqual({ done: 1, total: 1, skipped: 1, unavailable: 1 });
    expect(tagReadingProgress(state, [member('b')]).total).toBe(0);
  });
  it('orders only the queue, preserves history and does not reshuffle on progress changes', () => {
    const members = [member('a'), member('b'), member('c')];
    const state = moveReadingMember(reconcileTagReading(emptyTagState(), members, true), members, 'b', -1);
    expect(orderedMembers(markMember(state, 'b', 'done'), members).map((m) => m.entry_id)).toEqual(['b', 'a', 'c']);
    expect(moveReadingMember(state, members, 'b', -1)).toBe(state);
  });
  it('refresh retains an open removed paper but restore selects a legal member', () => {
    const state = { ...reconcileTagReading(emptyTagState(), [member('a'), member('b')], true), compare_entry_id: 'b' };
    expect(reconcileTagReading(state, [member('b')], false).active_entry_id).toBe('a');
    expect(reconcileTagReading(state, [member('b')], true)).toMatchObject({ active_entry_id: 'b', compare_entry_id: null });
    expect(reconcileTagReading(state, [], true)).toMatchObject({ active_entry_id: null, compare_entry_id: null });
  });
});
