import type { SourceSegment, SegmentType } from '@/shared/types/domain';

import type { RailLayoutItem } from './types';
import { groupAdjacentSegments } from './railSlotting';
import { headingLevel } from './segmentOutline';

export const RAIL_FALLBACK_HEIGHT = 520;
export const RAIL_MIN_ITEM_GAP = 8;
export const RAIL_MAX_VISIBLE_ITEMS = 160;
const RAIL_VERTICAL_PADDING = 8;

const SEGMENT_TYPE_PRIORITY: Record<SegmentType, number> = {
  heading: 500,
  table: 400,
  math: 400,
  figure: 400,
  code: 400,
  list: 300,
  aside_text: 250,
  page_footnote: 250,
  paragraph: 100,
  page_header: 0,
  page_footer: 0,
  page_number: 0
};

export function buildAdaptiveRailLayout({
  segments,
  railHeight,
  pinnedSegmentUids,
  bookmarkSegmentUids = new Set<string>(),
  noteSegmentUids,
  annotationSegmentUids
}: {
  segments: SourceSegment[];
  railHeight: number;
  pinnedSegmentUids: ReadonlySet<string>;
  bookmarkSegmentUids?: ReadonlySet<string>;
  noteSegmentUids: ReadonlySet<string>;
  annotationSegmentUids: ReadonlySet<string>;
}): RailLayoutItem[] {
  if (segments.length === 0) {
    return [];
  }

  const safeRailHeight = Math.max(16, railHeight);
  const usableHeight = Math.max(
    1,
    safeRailHeight - RAIL_VERTICAL_PADDING * 2
  );
  const bucketCount = Math.max(
    1,
    Math.min(
      RAIL_MAX_VISIBLE_ITEMS,
      Math.floor(usableHeight / RAIL_MIN_ITEM_GAP)
    )
  );
  const groups = groupAdjacentSegments({ bucketCount, segments });

  return groups.map((group, index) => {
    const segment = pickPrimarySegment({
      segments: group,
      pinnedSegmentUids,
      bookmarkSegmentUids,
      noteSegmentUids,
      annotationSegmentUids
    });
    const sequenceTop =
      groups.length === 1 ? 0.5 : index / (groups.length - 1);
    const topPx =
      RAIL_VERTICAL_PADDING +
      sequenceTop * usableHeight;

    return {
      segment,
      segments: group,
      top: (topPx / safeRailHeight) * 100,
      isHeading: segment.segment_type === 'heading',
      headingLevel:
        segment.segment_type === 'heading' ? headingLevel(segment) : null
    };
  });
}

function pickPrimarySegment({
  segments,
  pinnedSegmentUids,
  bookmarkSegmentUids,
  noteSegmentUids,
  annotationSegmentUids
}: {
  segments: SourceSegment[];
  pinnedSegmentUids: ReadonlySet<string>;
  bookmarkSegmentUids: ReadonlySet<string>;
  noteSegmentUids: ReadonlySet<string>;
  annotationSegmentUids: ReadonlySet<string>;
}) {
  return segments.reduce((best, candidate) =>
    segmentPriority(candidate, {
      pinnedSegmentUids,
      bookmarkSegmentUids,
      noteSegmentUids,
      annotationSegmentUids
    }) >
    segmentPriority(best, {
      pinnedSegmentUids,
      bookmarkSegmentUids,
      noteSegmentUids,
      annotationSegmentUids
    })
      ? candidate
      : best
  );
}

function segmentPriority(
  segment: SourceSegment,
  uidSets: {
    pinnedSegmentUids: ReadonlySet<string>;
    bookmarkSegmentUids: ReadonlySet<string>;
    noteSegmentUids: ReadonlySet<string>;
    annotationSegmentUids: ReadonlySet<string>;
  }
) {
  let priority = SEGMENT_TYPE_PRIORITY[segment.segment_type];

  if (matchesSegmentUid(segment, uidSets.bookmarkSegmentUids)) priority += 6_000;
  if (matchesSegmentUid(segment, uidSets.annotationSegmentUids)) {
    priority += 2_000;
  }
  if (matchesSegmentUid(segment, uidSets.noteSegmentUids)) {
    priority += 4_000;
  }
  if (matchesSegmentUid(segment, uidSets.pinnedSegmentUids)) {
    priority += 8_000;
  }

  return priority;
}

export function matchesSegmentUid(
  segment: SourceSegment,
  segmentUids: ReadonlySet<string>
) {
  return (
    segmentUids.has(segment.uid) ||
    Boolean(
      segment.continuation_group_id &&
        segmentUids.has(segment.continuation_group_id)
    )
  );
}
