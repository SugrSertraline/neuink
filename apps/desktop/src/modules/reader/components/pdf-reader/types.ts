import type { SourceSegment } from '@/shared/types/domain';

export type SegmentRegionItem = {
  bbox: readonly [number, number, number, number];
  hoverGroupUid: string;
  id: string;
  isContinuation: boolean;
  listItemIndex?: number;
  relationGroupUid: string | null;
  pageIdx: number;
  segment: SourceSegment;
  sourceSegment: SourceSegment;
};

export type PageSegments = {
  pageIdx: number;
  regions: SegmentRegionItem[];
  segments: SourceSegment[];
};

export type RailSection = {
  heading: SourceSegment | null;
  contents: SourceSegment[];
};

export type RailLayoutItem = {
  segment: SourceSegment;
  segments: SourceSegment[];
  top: number;
  isHeading: boolean;
  headingLevel: number | null;
};

export type RailItemMotion = {
  opacity: number;
  scaleX: number;
  scaleY: number;
  width: number;
  translateX: number;
  translateY: number;
  zIndex: number;
  shadow: string;
};
