import type { SourceSegment, SegmentType } from '@/shared/types/domain';

import type { RailLayoutItem } from './types';
import { bucketSegmentsByDocumentPosition } from './railSlotting';
import { compareDocumentSegments } from './readerUtils';
import { headingLevel } from './segmentOutline';

export const RAIL_FALLBACK_HEIGHT = 520;
export const RAIL_MIN_ITEM_GAP = 7;
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
  pageCount,
  railHeight,
  pinnedSegmentUids,
  noteSegmentUids,
  annotationSegmentUids
}: {
  segments: SourceSegment[];
  pageCount: number;
  railHeight: number;
  pinnedSegmentUids: Set<string>;
  noteSegmentUids: Set<string>;
  annotationSegmentUids: Set<string>;
}): RailLayoutItem[] {
  if (segments.length === 0) {
    return [];
  }

  const safeRailHeight = Math.max(80, railHeight);
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
  const headings = segments.filter(
    (segment) => segment.segment_type === 'heading'
  );
  const bodySegments = segments.filter(
    (segment) => segment.segment_type !== 'heading'
  );
  const bodyBucketCount = Math.max(0, bucketCount - headings.length);
  const bodyBuckets = bodyBucketCount > 0
    ? bucketSegmentsByDocumentPosition({
        bucketCount: bodyBucketCount,
        pageCount,
        segments: bodySegments
      })
    : [];
  const groups = [
    ...headings.map((segment) => ({ segments: [segment] })),
    ...bodyBuckets
  ].sort((left, right) =>
    compareDocumentSegments(left.segments[0], right.segments[0])
  );

  return groups.map((group, index) => {
    const segment = pickPrimarySegment({
      segments: group.segments,
      pinnedSegmentUids,
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
      segments: group.segments,
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
  noteSegmentUids,
  annotationSegmentUids
}: {
  segments: SourceSegment[];
  pinnedSegmentUids: Set<string>;
  noteSegmentUids: Set<string>;
  annotationSegmentUids: Set<string>;
}) {
  return segments.reduce((best, candidate) =>
    segmentPriority(candidate, {
      pinnedSegmentUids,
      noteSegmentUids,
      annotationSegmentUids
    }) >
    segmentPriority(best, {
      pinnedSegmentUids,
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
    pinnedSegmentUids: Set<string>;
    noteSegmentUids: Set<string>;
    annotationSegmentUids: Set<string>;
  }
) {
  let priority = SEGMENT_TYPE_PRIORITY[segment.segment_type];

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
