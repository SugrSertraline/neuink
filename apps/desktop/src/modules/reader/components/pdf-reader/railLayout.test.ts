import { describe, expect, it } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';

import {
  buildAdaptiveRailLayout,
  RAIL_MAX_VISIBLE_ITEMS,
  RAIL_MIN_ITEM_GAP
} from './railLayout';

const EMPTY_UIDS = new Set<string>();

describe('buildAdaptiveRailLayout', () => {
  it('limits marker density from the available rail height', () => {
    const railHeight = 520;
    const segments = Array.from({ length: 500 }, (_, index) =>
      makeSegment({
        uid: `segment-${index}`,
        page_idx: Math.floor(index / 5),
        bbox: [100, (index % 5) * 190, 900, (index % 5) * 190 + 100]
      })
    );

    const layout = buildLayout({ segments, railHeight });
    const maximumByHeight = Math.floor((railHeight - 16) / RAIL_MIN_ITEM_GAP);

    expect(layout.length).toBe(maximumByHeight);
    expect(layout.length).toBeLessThanOrEqual(RAIL_MAX_VISIBLE_ITEMS);
    expect(layout.every((item, index) => index === 0 || item.top > layout[index - 1].top)).toBe(true);
  });

  it('keeps document order while compacting large empty ranges', () => {
    const layout = buildLayout({
      segments: [
        makeSegment({ uid: 'start', page_idx: 0, bbox: [0, 0, 100, 100] }),
        makeSegment({ uid: 'middle', page_idx: 49, bbox: [0, 500, 100, 600] }),
        makeSegment({ uid: 'end', page_idx: 99, bbox: [0, 900, 100, 1000] })
      ],
      railHeight: 520
    });

    expect(layout[0].top).toBeLessThan(3);
    expect(layout[1].top).toBeGreaterThan(48);
    expect(layout[1].top).toBeLessThan(52);
    expect(layout[2].top).toBeGreaterThan(97);
  });

  it('compresses a large document-position gap without losing order', () => {
    const layout = buildLayout({
      segments: [
        makeSegment({ uid: 'early-1', page_idx: 0 }),
        makeSegment({ uid: 'early-2', page_idx: 2 }),
        makeSegment({ uid: 'late-1', page_idx: 80 }),
        makeSegment({ uid: 'late-2', page_idx: 82 })
      ],
      railHeight: 520
    });

    const largestGap = Math.max(
      ...layout.slice(1).map((item, index) => item.top - layout[index].top)
    );
    expect(largestGap).toBeLessThan(45);
    expect(layout.map((item) => item.segment.uid)).toEqual([
      'early-1',
      'early-2',
      'late-1',
      'late-2'
    ]);
    const gaps = layout.slice(1).map((item, index) => item.top - layout[index].top);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.001);
  });

  it('uses interaction, note, and annotation priority inside one slot', () => {
    const plain = makeSegment({ uid: 'plain' });
    const annotated = makeSegment({ uid: 'annotated' });
    const noted = makeSegment({ uid: 'noted' });
    const active = makeSegment({ uid: 'active' });
    const segments = [plain, annotated, noted, active];

    const layout = buildAdaptiveRailLayout({
      segments,
      railHeight: 24,
      pinnedSegmentUids: new Set(['active']),
      noteSegmentUids: new Set(['noted']),
      annotationSegmentUids: new Set(['annotated'])
    });

    expect(layout).toHaveLength(1);
    expect(layout[0].segment.uid).toBe('active');
    expect(layout[0].segments).toEqual(segments);
  });

  it('keeps every heading as an independent hierarchy marker', () => {
    const heading = makeSegment({
      uid: 'heading',
      segment_type: 'heading',
      mineru_metadata: { level: '1' }
    });
    const body = makeSegment({ uid: 'body', bbox: [100, 300, 900, 400] });

    const layout = buildLayout({
      segments: [heading, body],
      railHeight: 80
    });

    expect(layout).toHaveLength(2);
    expect(layout[0]).toMatchObject({
      headingLevel: 1,
      isHeading: true,
      segment: { uid: 'heading' },
      segments: [{ uid: 'heading' }]
    });
    expect(layout[1]).toMatchObject({ isHeading: false, segment: { uid: 'body' } });
  });

  it('recognizes notes attached to a continuation group', () => {
    const plain = makeSegment({ uid: 'plain' });
    const continued = makeSegment({
      uid: 'continued-real',
      continuation_group_id: 'continued-logical'
    });

    const layout = buildAdaptiveRailLayout({
      segments: [plain, continued],
      railHeight: 24,
      pinnedSegmentUids: EMPTY_UIDS,
      noteSegmentUids: new Set(['continued-logical']),
      annotationSegmentUids: EMPTY_UIDS
    });

    expect(layout).toHaveLength(1);
    expect(layout[0].segment.uid).toBe('continued-real');
  });

  it('keeps marked body segments accessible when headings fill a short rail, without overlapping hit areas', () => {
    const segments = Array.from({ length: 120 }, (_, index) => makeSegment({ uid: `s-${index}`, page_idx: index,
      segment_type: index % 2 === 0 ? 'heading' : 'paragraph' }));
    const bookmarks = new Set(['s-1', 's-51', 's-119']);
    const layout = buildAdaptiveRailLayout({ segments, railHeight: 120,
      pinnedSegmentUids: EMPTY_UIDS, bookmarkSegmentUids: bookmarks, noteSegmentUids: EMPTY_UIDS, annotationSegmentUids: EMPTY_UIDS });
    expect(layout.flatMap(item => item.segments)).toEqual(segments);
    expect(layout.length).toBe(Math.floor((120 - 16) / RAIL_MIN_ITEM_GAP));
    for (let i = 1; i < layout.length; i++) expect((layout[i].top - layout[i - 1].top) * 1.2).toBeGreaterThanOrEqual(RAIL_MIN_ITEM_GAP);
    for (const uid of bookmarks) expect(layout.some(item => item.segments.some(segment => segment.uid === uid))).toBe(true);
  });

  it('keeps every marked position accessible in a rail shorter than a toolbar', () => {
    const segments = Array.from({ length: 6 }, (_, index) => makeSegment({ uid: `s-${index}`, page_idx: index }));
    const layout = buildAdaptiveRailLayout({ segments, railHeight: 24,
      pinnedSegmentUids: EMPTY_UIDS, bookmarkSegmentUids: new Set(segments.map(segment => segment.uid)), noteSegmentUids: EMPTY_UIDS, annotationSegmentUids: EMPTY_UIDS });
    expect(layout).toHaveLength(1);
    expect(layout[0].segments).toEqual(segments);
    expect(layout[0].top).toBe(50);
  });

  it('fills available slots even when many segments share the same page coordinates', () => {
    const segments = Array.from({ length: 200 }, (_, index) => makeSegment({ uid: `s-${index}` }));
    const short = buildLayout({ segments, railHeight: 256 });
    const tall = buildLayout({ segments, railHeight: 496 });
    expect(short).toHaveLength(30);
    expect(tall).toHaveLength(60);
    for (const layout of [short, tall]) expect(layout.flatMap(item => item.segments)).toEqual(segments);
  });

  it('does not move or regroup the rail when records or the active segment change', () => {
    const segments = Array.from({ length: 100 }, (_, index) => makeSegment({ uid: `s-${index}`, segment_type: index % 12 === 0 ? 'heading' : 'paragraph' }));
    const before = buildLayout({ segments, railHeight: 400 });
    const after = buildAdaptiveRailLayout({ segments, railHeight: 400, pinnedSegmentUids: new Set(['s-35']),
      bookmarkSegmentUids: new Set(['s-2']), noteSegmentUids: new Set(['s-3']), annotationSegmentUids: new Set(['s-4']) });
    expect(after.map(({ segments, top }) => ({ segments, top }))).toEqual(before.map(({ segments, top }) => ({ segments, top })));
    expect(after).toHaveLength(48);
    expect(after.flatMap(item => item.segments)).toEqual(segments);
    expect(after.filter(item => item.isHeading).every(item => item.segments.length === 1)).toBe(true);
  });

  it('expands all segments when they fit, and caps very tall rails', () => {
    const segments = Array.from({ length: 800 }, (_, index) => makeSegment({ uid: `s-${index}` }));
    expect(buildLayout({ segments: segments.slice(0, 10), railHeight: 520 })).toHaveLength(10);
    expect(buildLayout({ segments, railHeight: 2400 })).toHaveLength(RAIL_MAX_VISIBLE_ITEMS);
    expect(buildLayout({ segments: [], railHeight: 520 })).toEqual([]);
  });
});

function buildLayout({
  segments,
  railHeight
}: {
  segments: SourceSegment[];
  railHeight: number;
}) {
  return buildAdaptiveRailLayout({
    segments,
    railHeight,
    pinnedSegmentUids: EMPTY_UIDS,
    noteSegmentUids: EMPTY_UIDS,
    annotationSegmentUids: EMPTY_UIDS
  });
}

function makeSegment(overrides: Partial<SourceSegment>): SourceSegment {
  return {
    uid: 'segment',
    segment_type: 'paragraph',
    page_idx: 0,
    bbox: [100, 100, 900, 200],
    text: 'Segment text',
    markdown: null,
    ...overrides
  };
}
