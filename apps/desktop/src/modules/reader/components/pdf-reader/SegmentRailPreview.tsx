import { MessageSquareText, StickyNote } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { HoverCardContent } from '@/components/ui/hover-card';
import type { SourceSegment } from '@/shared/types/domain';

import { matchesSegmentUid } from './railLayout';
import { segmentTypeLabel } from './readerUtils';

export function SegmentRailPreview({
  annotationSegmentUids,
  noteSegmentUids,
  segment,
  segments,
  onJumpToSegment,
  onOpenOutline
}: {
  annotationSegmentUids: ReadonlySet<string>;
  noteSegmentUids: ReadonlySet<string>;
  segment: SourceSegment;
  segments: SourceSegment[];
  onJumpToSegment: (segmentUid: string) => void;
  onOpenOutline?: () => void;
}) {
  const markedSegments = segments.filter(
    (candidate) =>
      matchesSegmentUid(candidate, noteSegmentUids) ||
      matchesSegmentUid(candidate, annotationSegmentUids)
  );
  const hasNote = markedSegments.some((candidate) =>
    matchesSegmentUid(candidate, noteSegmentUids)
  );
  const hasAnnotation = markedSegments.some((candidate) =>
    matchesSegmentUid(candidate, annotationSegmentUids)
  );

  return (
    <HoverCardContent
      align="center"
      className="z-[var(--z-reader-preview)] w-64 p-2.5"
      side="right"
      sideOffset={10}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-xs">
        <Badge variant="secondary">
          {segmentTypeLabel(segment.segment_type)}
        </Badge>
        <span className="text-muted-foreground">
          第 {segment.page_idx + 1} 页
        </span>
        {hasNote ? (
          <StickyNote
            aria-label="已有笔记"
            className="ml-auto text-violet-600"
            size={13}
          />
        ) : null}
        {hasAnnotation ? (
          <MessageSquareText
            aria-label="已有批注"
            className={hasNote ? undefined : 'ml-auto'}
            color="#c2410c"
            size={13}
          />
        ) : null}
      </div>
      <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">
        {segmentExcerpt(segment) || '该片段没有可预览的文本。'}
      </p>
      {segments.length > 1 ? (
        <SegmentList
          annotationSegmentUids={annotationSegmentUids}
          noteSegmentUids={noteSegmentUids}
          segments={segments}
          onJumpToSegment={onJumpToSegment}
        />
      ) : null}
      {segments.length === 1 ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
          <span>点击左侧横条可定位到此处</span>
          {segment.segment_type === 'heading' && onOpenOutline ? (
            <button
              className="shrink-0 font-medium text-primary hover:underline"
              type="button"
              onClick={onOpenOutline}
            >
              查看目录
            </button>
          ) : null}
        </div>
      ) : null}
    </HoverCardContent>
  );
}

function SegmentList({
  annotationSegmentUids,
  noteSegmentUids,
  segments,
  onJumpToSegment
}: {
  annotationSegmentUids: ReadonlySet<string>;
  noteSegmentUids: ReadonlySet<string>;
  segments: SourceSegment[];
  onJumpToSegment: (segmentUid: string) => void;
}) {
  return (
    <div className="mt-2 max-h-36 space-y-1 overflow-y-auto border-t pt-2">
      <div className="px-1 pb-0.5 text-[10px] text-muted-foreground">
        此位置有 {segments.length} 个片段 · 点击任一项定位
      </div>
      {segments.map((segment) => {
        const hasNote = matchesSegmentUid(segment, noteSegmentUids);
        const hasAnnotation = matchesSegmentUid(
          segment,
          annotationSegmentUids
        );

        return (
          <button
            className="block w-full rounded-md bg-muted/55 px-2 py-1.5 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45"
            key={segment.uid}
            type="button"
            onClick={() => onJumpToSegment(segment.uid)}
          >
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>第 {segment.page_idx + 1} 页</span>
              <span>·</span>
              <span>{segmentTypeLabel(segment.segment_type)}</span>
              {hasNote ? (
                <StickyNote
                  aria-label="该片段有笔记"
                  className="ml-auto text-violet-600"
                  size={12}
                />
              ) : null}
              {hasAnnotation ? (
                <MessageSquareText
                  aria-label="该片段有批注"
                  className={hasNote ? undefined : 'ml-auto'}
                  color="#c2410c"
                  size={12}
                />
              ) : null}
            </div>
            <div className="line-clamp-1 text-[11px] text-foreground/75">
              {segmentExcerpt(segment) || '无可预览文本'}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function segmentExcerpt(segment: SourceSegment) {
  return (segment.markdown ?? segment.text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>|~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
