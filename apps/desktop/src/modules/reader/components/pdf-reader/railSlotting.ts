import type { SourceSegment } from '@/shared/types/domain';

export function groupAdjacentSegments({
  bucketCount,
  segments
}: {
  bucketCount: number;
  segments: SourceSegment[];
}): SourceSegment[][] {
  const count = Math.min(segments.length, Math.max(1, bucketCount));
  if (!count) return [];
  // Keep headings separate when there is room, and never group across them.
  const runs: SourceSegment[][] = [];
  for (const segment of segments) {
    const last = runs[runs.length - 1];
    if (!last || segment.segment_type === 'heading' || last[0].segment_type === 'heading') {
      runs.push([segment]);
    } else {
      last.push(segment);
    }
  }
  if (runs.length > count) return splitEvenly(segments, count);

  const slots = runs.map(() => 1);
  for (let allocated = runs.length; allocated < count; allocated++) {
    let largest = -1;
    for (let index = 0; index < runs.length; index++) {
      if (slots[index] >= runs[index].length) continue;
      if (largest === -1 || runs[index].length / slots[index] > runs[largest].length / slots[largest]) {
        largest = index;
      }
    }
    slots[largest]++;
  }
  return runs.flatMap((run, index) => splitEvenly(run, slots[index]));
}

function splitEvenly(segments: SourceSegment[], count: number) {
  return Array.from({ length: count }, (_, index) => segments.slice(
    Math.floor(index * segments.length / count),
    Math.floor((index + 1) * segments.length / count)
  ));
}
