import type { SourceSegment } from '@/shared/types/domain';

import { compareDocumentSegments } from '../pdf-reader/readerUtils';

export type ReflowSegmentGroup = {
  assetPath?: string | null;
  body: SourceSegment;
  captions: SourceSegment[];
  footnotes: SourceSegment[];
  id: string;
  kind: 'text' | 'visual';
  segments: SourceSegment[];
};

const HIDDEN_SEGMENT_TYPES = new Set<SourceSegment['segment_type']>([
  'page_header',
  'page_footer',
  'page_number'
]);

export function buildReflowSegmentGroups(segments: SourceSegment[]) {
  const sorted = segments
    .filter((segment) => !HIDDEN_SEGMENT_TYPES.has(segment.segment_type))
    .sort(compareDocumentSegments);
  const consumed = new Set<string>();
  const groups: ReflowSegmentGroup[] = [];

  for (const segment of sorted) {
    if (consumed.has(segment.uid)) {
      continue;
    }

    if (isVisualBody(segment) && segment.visual_group_id) {
      const grouped = sorted.filter(
        (item) => item.visual_group_id === segment.visual_group_id
      );
      grouped.forEach((item) => consumed.add(item.uid));
      groups.push(buildVisualSegmentGroup(segment, grouped));
      continue;
    }

    consumed.add(segment.uid);
    groups.push({
      assetPath: segment.asset_path,
      body: segment,
      captions: [],
      footnotes: [],
      id: segment.uid,
      kind: 'text',
      segments: [segment]
    });
  }

  return groups;
}

function buildVisualSegmentGroup(body: SourceSegment, grouped: SourceSegment[]): ReflowSegmentGroup {
  const sorted = grouped.sort(compareDocumentSegments);
  const captions = sorted.filter((segment) => segment.block_role === 'caption');
  const footnotes = sorted.filter((segment) => segment.block_role === 'footnote');
  const bodySegment = sorted.find(isVisualBody) ?? body;

  return {
    assetPath: bodySegment.asset_path,
    body: bodySegment,
    captions,
    footnotes,
    id: bodySegment.visual_group_id ?? bodySegment.uid,
    kind: 'visual',
    segments: sorted
  };
}

function isVisualBody(segment: SourceSegment) {
  return (
    (segment.raw_type === 'image' ||
      segment.raw_type === 'chart' ||
      segment.raw_type === 'table') &&
    segment.block_role !== 'caption' &&
    segment.block_role !== 'footnote'
  );
}
