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

    const layout = buildLayout({ segments, pageCount: 100, railHeight });
    const maximumByHeight = Math.floor((railHeight - 16) / RAIL_MIN_ITEM_GAP);

    expect(layout.length).toBeLessThanOrEqual(maximumByHeight);
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
      pageCount: 100,
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
      pageCount: 100,
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
      pageCount: 1,
      railHeight: 520,
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
      pageCount: 1,
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
      pageCount: 1,
      railHeight: 520,
      pinnedSegmentUids: EMPTY_UIDS,
      noteSegmentUids: new Set(['continued-logical']),
      annotationSegmentUids: EMPTY_UIDS
    });

    expect(layout).toHaveLength(1);
    expect(layout[0].segment.uid).toBe('continued-real');
  });
});

function buildLayout({
  segments,
  pageCount,
  railHeight
}: {
  segments: SourceSegment[];
  pageCount: number;
  railHeight: number;
}) {
  return buildAdaptiveRailLayout({
    segments,
    pageCount,
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
