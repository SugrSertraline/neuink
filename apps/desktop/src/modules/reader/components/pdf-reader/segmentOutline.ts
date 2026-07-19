import type { SourceSegment } from '@/shared/types/domain';

import { compareDocumentSegments } from './readerUtils';

export type SegmentOutlineNode = {
  children: SegmentOutlineNode[];
  level: number;
  segment: SourceSegment;
  title: string;
};

export function headingLevel(segment: SourceSegment) {
  const metadataLevel = Number(segment.mineru_metadata?.level);
  if (Number.isFinite(metadataLevel) && metadataLevel > 0) {
    return Math.min(6, Math.max(1, Math.round(metadataLevel)));
  }

  const markdownHeading = segment.markdown?.match(/^\s*(#{1,6})\s+/);
  return markdownHeading ? markdownHeading[1].length : 2;
}

export function headingTitle(segment: SourceSegment) {
  return (segment.markdown ?? segment.text)
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>|~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || `第 ${segment.page_idx + 1} 页标题`;
}

export function buildSegmentOutline(segments: SourceSegment[]) {
  const roots: SegmentOutlineNode[] = [];
  const stack: SegmentOutlineNode[] = [];
  const headings = segments
    .filter((segment) => segment.segment_type === 'heading')
    .sort(compareDocumentSegments);

  for (const segment of headings) {
    const node: SegmentOutlineNode = {
      children: [],
      level: headingLevel(segment),
      segment,
      title: headingTitle(segment)
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push(node);
  }

  return roots;
}

export function resolveActiveHeadingUid(
  segments: SourceSegment[],
  activeSegmentUid: string | null
) {
  if (!activeSegmentUid) return null;

  const sorted = [...segments].sort(compareDocumentSegments);
  const activeIndex = sorted.findIndex((segment) =>
    segmentMatchesUid(segment, activeSegmentUid)
  );
  if (activeIndex < 0) return null;

  for (let index = activeIndex; index >= 0; index -= 1) {
    if (sorted[index].segment_type === 'heading') {
      return sorted[index].uid;
    }
  }
  return null;
}

export function outlineAncestorUids(
  nodes: SegmentOutlineNode[],
  targetUid: string | null
) {
  if (!targetUid) return [];

  const path: string[] = [];
  const visit = (items: SegmentOutlineNode[]): boolean => {
    for (const item of items) {
      if (item.segment.uid === targetUid) return true;
      path.push(item.segment.uid);
      if (visit(item.children)) return true;
      path.pop();
    }
    return false;
  };
  return visit(nodes) ? path : [];
}

function segmentMatchesUid(segment: SourceSegment, uid: string) {
  return segment.uid === uid || segment.continuation_group_id === uid;
}
