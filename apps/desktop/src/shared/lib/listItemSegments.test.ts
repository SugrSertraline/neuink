import { describe, expect, it } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import { findSourceSegment, listItemSegments, listItemTexts } from './listItemSegments';
import { readingAssistantContext } from '@/modules/reader/components/readingAssistantContext';
import { buildReflowGroupIndex } from '@/modules/reader/components/reflow/reflowVirtualization';
import { buildReflowSegmentGroups } from '@/modules/reader/components/reflow/buildReflowBlocks';
import { reflowJumpTarget } from '@/modules/reader/sourceJump';

export const list: SourceSegment = { uid: 'list', segment_type: 'list', page_idx: 0, bbox: null,
  continuation_group_id: 'continued-list', markdown: '- First\n- Second', text: 'First\nSecond',
  mineru_metadata: { list_item_regions: JSON.stringify([
    { bbox: [100, 200, 400, 300], text: 'First' },
    { bbox: [100, 100, 400, 250], page_idx: 1, text: 'Second' },
  ]) } };

describe('list item source identity', () => {
  it('keeps each item, its page and bounds distinct from siblings and the saved list', () => {
    const items = listItemSegments(list);
    expect(items.map(item => readingAssistantContext({ id: 'paper', title: 'Paper' }, item)))
      .toEqual([expect.objectContaining({ segmentUid: 'list:list-item:0', text: 'First', pageIdx: 0 }),
        expect.objectContaining({ segmentUid: 'list:list-item:1', text: 'Second', pageIdx: 1 })]);
    expect(findSourceSegment([list], items[1].uid)).toMatchObject({ bbox: [100, 100, 400, 250], continuation_group_id: null });
    expect(findSourceSegment([list], list.uid)).toBe(list);
    expect(findSourceSegment([list], 'continued-list')).toBe(list);
    expect(findSourceSegment([list], 'list:list-item:99')).toBeUndefined();
    expect(listItemSegments(items[1])).toEqual([]);
  });
  it('routes a cross-page item to its own source and containing reflow row', () => {
    const groups = buildReflowSegmentGroups([list]);
    expect(buildReflowGroupIndex(groups).get('list:list-item:1')).toBe(0);
    expect(reflowJumpTarget(groups, { kind: 'segment', segmentUid: 'list:list-item:1', pageIdx: 1, requestKey: 1 }))
      .toEqual({ pageIdx: 1, segmentUid: 'list:list-item:1' });
  });
  it('keeps multiline and nested content with its item when coordinates are unavailable', () => {
    const source = '- First\n  wrapped line\n  - Nested\n- Second\n\n  continued';
    expect(listItemTexts(source)).toEqual(['First\n  wrapped line\n  - Nested', 'Second\n\n  continued']);
    expect(listItemSegments({ ...list, markdown: source, mineru_metadata: {} })[1])
      .toMatchObject({ uid: 'list:list-item:1', text: 'Second\n\n  continued', bbox: null });
  });
  it.each(['numbered', 'bullet', 'reference'])('uses the same item contract for %s lists', kind => {
    const text = kind === 'numbered' ? '1. Alpha\n2. Beta' : kind === 'bullet' ? '* Alpha\n* Beta' : '[1] Alpha\n[2] Beta';
    const items = listItemSegments({ ...list, markdown: text, sub_type: kind, mineru_metadata: {} });
    expect(items).toHaveLength(2);
    expect(items[1].text).toContain('Beta');
    expect(items[1].text).not.toContain('Alpha');
  });
});
