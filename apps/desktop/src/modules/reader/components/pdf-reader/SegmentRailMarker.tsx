import { HoverCard, HoverCardTrigger } from '@/components/ui/hover-card';
import { HOVER_TIMING } from '@/components/ui/hover-interactions';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

import type { RailLayoutItem } from './types';
import { calculateRailItemMotion } from './railMotion';
import { SegmentRailPreview } from './SegmentRailPreview';
import { segmentColor, segmentTypeLabel } from './readerUtils';
import { segmentRailJumpTarget, segmentRailMarkLabel, summarizeSegmentRailMarks, type SegmentRailMarkSummary } from './segmentRailMarks';

export function SegmentRailMarker({
  activeSegmentUid,
  annotationSegmentUids,
  bookmarkSegmentUids,
  flashSegmentUid,
  item,
  noteSegmentUids,
  pointerY,
  railHeight,
  railWidth,
  selectedSegmentUid,
  onJumpToSegment,
  onOpenOutline,
  onHoverOpenChange,
  onPointerFocus
}: {
  activeSegmentUid: string | null;
  annotationSegmentUids: ReadonlySet<string>;
  bookmarkSegmentUids: ReadonlySet<string>;
  flashSegmentUid: string | null;
  item: RailLayoutItem;
  noteSegmentUids: ReadonlySet<string>;
  pointerY: number | null;
  railHeight: number;
  railWidth: number;
  selectedSegmentUid: string | null;
  onJumpToSegment: (segmentUid: string) => void;
  onOpenOutline: () => void;
  onHoverOpenChange: (open: boolean) => void;
  onPointerFocus: (pointerY: number | null) => void;
}) {
  const { headingLevel, isHeading, segment, segments, top } = item;
  const isCurrent = groupMatchesUid(segments, activeSegmentUid);
  const isSelected = groupMatchesUid(segments, selectedSegmentUid);
  const isFlashed = groupMatchesUid(segments, flashSegmentUid);
  const { summary, target } = useMemo(() => {
    const marks = { bookmarkSegmentUids, noteSegmentUids, annotationSegmentUids };
    return { summary: summarizeSegmentRailMarks(item.segments, marks), target: segmentRailJumpTarget(item, marks) };
  }, [item, bookmarkSegmentUids, noteSegmentUids, annotationSegmentUids]);
  const marked = summary.total > 0;
  const color = summary.bookmarks ? 'var(--reader-ribbon)'
    : summary.notes ? 'var(--info)'
    : summary.annotations ? 'var(--warning)'
    : isCurrent || isSelected || isFlashed ? 'var(--primary)' : segmentColor(segment.segment_type);
  const motion = calculateRailItemMotion({
    itemTopPercent: top,
    pointerY,
    railHeight,
    railWidth,
    isHeading,
    headingLevel
  });
  return (
    <HoverCard
      openDelay={HOVER_TIMING.reader}
      onOpenChange={onHoverOpenChange}
    >
      <HoverCardTrigger asChild>
        <button
          aria-label={markerLabel(item, summary, target)}
          aria-current={isCurrent ? 'location' : undefined}
          className={cn(
            'absolute left-1 h-2 -translate-y-1/2 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
            isFlashed && 'animate-pulse motion-reduce:animate-none'
          )}
          style={{
            top: `calc(${top}% + ${motion.translateY}px)`,
            width: `${Math.max(0, railWidth - 8)}px`,
            zIndex: motion.zIndex
          }}
          data-rail-marker="true"
          data-rail-marked={marked || undefined}
          type="button"
          onBlur={() => onPointerFocus(null)}
          onClick={() => onJumpToSegment(target.uid)}
          onFocus={() => onPointerFocus((top / 100) * railHeight)}
        >
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute left-0 top-1/2 block origin-left rounded-full transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none',
              isHeading ? 'h-0.5' : 'h-px'
            )}
            style={{
              background: color,
              opacity: isCurrent || isSelected || isFlashed ? 1 : motion.opacity,
              width: motion.width,
              transform: `translateY(-50%) scaleX(${motion.scaleX}) scaleY(${motion.scaleY})`
            }}
          />
        </button>
      </HoverCardTrigger>
      <SegmentRailPreview
        annotationSegmentUids={annotationSegmentUids}
        bookmarkSegmentUids={bookmarkSegmentUids}
        noteSegmentUids={noteSegmentUids}
        segment={target}
        segments={segments}
        onJumpToSegment={onJumpToSegment}
        onOpenOutline={onOpenOutline}
      />
    </HoverCard>
  );
}

function groupMatchesUid(segments: RailLayoutItem['segments'], uid: string | null) {
  if (!uid) return false;

  return segments.some(
    (segment) => segment.uid === uid || segment.continuation_group_id === uid
  );
}

function markerLabel(item: RailLayoutItem, summary: SegmentRailMarkSummary, target: RailLayoutItem['segment']) {
  return [
    item.segments.length > 1
      ? `${item.segments.length} 个相邻片段`
      : segmentTypeLabel(target.segment_type),
    `第 ${target.page_idx + 1} 页`,
    segmentRailMarkLabel(summary)
  ]
    .filter(Boolean)
    .join('，');
}
