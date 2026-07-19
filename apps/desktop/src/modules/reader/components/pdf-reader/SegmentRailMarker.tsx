import { HoverCard, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';

import type { RailLayoutItem } from './types';
import { calculateRailItemMotion } from './railMotion';
import { matchesSegmentUid } from './railLayout';
import { SegmentRailPreview } from './SegmentRailPreview';
import { segmentColor, segmentTypeLabel } from './readerUtils';

const NOTE_RAIL_COLOR = '#8a3ffc';
const ANNOTATION_RAIL_COLOR = '#ff832b';
const GROUPED_RAIL_GRADIENT =
  'linear-gradient(90deg, #0d9488 0%, #06b6d4 48%, #2563eb 100%)';

export function SegmentRailMarker({
  activeSegmentUid,
  annotationSegmentUids,
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
  const hasNote = segments.some((candidate) =>
    matchesSegmentUid(candidate, noteSegmentUids)
  );
  const hasAnnotation = segments.some((candidate) =>
    matchesSegmentUid(candidate, annotationSegmentUids)
  );
  const isGrouped = segments.length > 1;
  const color = segmentColor(segment.segment_type);
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
      closeDelay={100}
      openDelay={100}
      onOpenChange={onHoverOpenChange}
    >
      <HoverCardTrigger asChild>
        <button
          aria-label={markerLabel(item, hasNote, hasAnnotation)}
          className={cn(
            'absolute left-1 h-2 -translate-y-1/2 origin-left rounded-full outline-none',
            'will-change-transform transition-[top,transform,opacity] duration-200',
            'ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:ring-2 focus-visible:ring-primary/45',
            'cursor-pointer',
            isFlashed && 'animate-pulse'
          )}
          style={{
            top: `calc(${top}% + ${motion.translateY}px)`,
            opacity: motion.opacity,
            width: `${motion.width}px`,
            zIndex: motion.zIndex,
            transform: [
              'translateY(-50%)',
              `scaleX(${motion.scaleX})`,
              `scaleY(${motion.scaleY})`
            ].join(' ')
          }}
          data-rail-marker="true"
          type="button"
          onBlur={() => onPointerFocus(null)}
          onClick={() => onJumpToSegment(segment.uid)}
          onFocus={() => onPointerFocus((top / 100) * railHeight)}
        >
          <span
            className={cn(
              'absolute left-0 top-1/2 block w-full -translate-y-1/2 rounded-full',
              'transition-[height,background,box-shadow,opacity] duration-200',
              hasNote || hasAnnotation || isHeading ? 'h-0.5' : 'h-px'
            )}
            style={{
              background: markerBackground(
                color,
                hasNote,
                hasAnnotation,
                isGrouped
              ),
              boxShadow: markerShadow({
                hasAnnotation,
                hasNote,
                isCurrent,
                isFlashed,
                isSelected,
                motionShadow: motion.shadow
              })
            }}
          />
        </button>
      </HoverCardTrigger>
      <SegmentRailPreview
        annotationSegmentUids={annotationSegmentUids}
        noteSegmentUids={noteSegmentUids}
        segment={segment}
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

function markerLabel(item: RailLayoutItem, hasNote: boolean, hasAnnotation: boolean) {
  return [
    item.segments.length > 1
      ? `${item.segments.length} 个相邻片段`
      : segmentTypeLabel(item.segment.segment_type),
    `第 ${item.segment.page_idx + 1} 页`,
    hasNote ? '包含笔记' : null,
    hasAnnotation ? '包含批注' : null
  ]
    .filter(Boolean)
    .join('，');
}

function markerBackground(
  color: string,
  hasNote: boolean,
  hasAnnotation: boolean,
  isGrouped: boolean
) {
  if (isGrouped) {
    if (hasNote && hasAnnotation) {
      return 'linear-gradient(90deg, #0d9488 0%, #06b6d4 38%, #2563eb 72%, #8a3ffc 72% 86%, #ff832b 86% 100%)';
    }
    if (hasNote) {
      return 'linear-gradient(90deg, #0d9488 0%, #06b6d4 44%, #2563eb 82%, #8a3ffc 82% 100%)';
    }
    if (hasAnnotation) {
      return 'linear-gradient(90deg, #0d9488 0%, #06b6d4 44%, #2563eb 82%, #ff832b 82% 100%)';
    }
    return GROUPED_RAIL_GRADIENT;
  }
  if (hasNote && hasAnnotation) {
    return `linear-gradient(90deg, ${color} 0 46%, ${NOTE_RAIL_COLOR} 46% 74%, ${ANNOTATION_RAIL_COLOR} 74% 100%)`;
  }
  if (hasNote) {
    return `linear-gradient(90deg, ${color} 0 62%, ${NOTE_RAIL_COLOR} 62% 100%)`;
  }
  if (hasAnnotation) {
    return `linear-gradient(90deg, ${color} 0 62%, ${ANNOTATION_RAIL_COLOR} 62% 100%)`;
  }
  return color;
}

function markerShadow({
  hasAnnotation,
  hasNote,
  isCurrent,
  isFlashed,
  isSelected,
  motionShadow
}: {
  hasAnnotation: boolean;
  hasNote: boolean;
  isCurrent: boolean;
  isFlashed: boolean;
  isSelected: boolean;
  motionShadow: string;
}) {
  if (isSelected || isFlashed) return '0 0 0 2px rgba(37, 99, 235, 0.38), 0 3px 9px rgba(15, 23, 42, 0.18)';
  if (isCurrent) return '0 0 0 2px rgba(37, 99, 235, 0.24), 0 0 13px rgba(37, 99, 235, 0.5)';
  if (hasNote) return '0 0 0 1px rgba(138, 63, 252, 0.16)';
  if (hasAnnotation) return '0 0 0 1px rgba(255, 131, 43, 0.18)';
  return motionShadow;
}
