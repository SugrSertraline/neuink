import type { SourceSegment } from '@/shared/types/domain';

import { normalizeBbox } from './readerUtils';

export type RailSegmentBucket = {
  index: number;
  segments: SourceSegment[];
};

export function bucketSegmentsByDocumentPosition({
  bucketCount,
  pageCount,
  segments
}: {
  bucketCount: number;
  pageCount: number;
  segments: SourceSegment[];
}): RailSegmentBucket[] {
  const buckets = new Map<number, SourceSegment[]>();

  for (const segment of segments) {
    const position = getSegmentDocumentPosition(segment, pageCount);
    const index = Math.min(
      bucketCount - 1,
      Math.floor(position * bucketCount)
    );
    const bucket = buckets.get(index) ?? [];
    bucket.push(segment);
    buckets.set(index, bucket);
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, bucketSegments]) => ({
      index,
      segments: bucketSegments
    }));
}

export function getSegmentDocumentPosition(
  segment: SourceSegment,
  pageCount: number
) {
  const bbox = normalizeBbox(segment.bbox);
  const pagePosition = bbox ? bbox[1] / 1000 : 0;

  return Math.min(
    1,
    Math.max(0, (segment.page_idx + pagePosition) / Math.max(1, pageCount))
  );
}
