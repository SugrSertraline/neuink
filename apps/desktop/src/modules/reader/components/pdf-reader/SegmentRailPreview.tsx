import { Bookmark, MessageSquareText, StickyNote } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { HoverCardContent } from '@/components/ui/hover-card';
import type { SourceSegment } from '@/shared/types/domain';

import { cn } from '@/lib/utils';
import { summarizeSegmentRailMarks, type SegmentRailMarks, type SegmentRailMarkSummary } from './segmentRailMarks';
import { segmentTypeLabel } from './readerUtils';

export function SegmentRailPreview({
  annotationSegmentUids,
  bookmarkSegmentUids,
  noteSegmentUids,
  segment,
  segments,
  onJumpToSegment,
  onOpenOutline
}: {
  annotationSegmentUids: ReadonlySet<string>;
  bookmarkSegmentUids: ReadonlySet<string>;
  noteSegmentUids: ReadonlySet<string>;
  segment: SourceSegment;
  segments: SourceSegment[];
  onJumpToSegment: (segmentUid: string) => void;
  onOpenOutline?: () => void;
}) {
  const marks = { bookmarkSegmentUids, noteSegmentUids, annotationSegmentUids };
  const summary = summarizeSegmentRailMarks(segments, marks);

  return (
    <HoverCardContent
      align="center"
      layer="reader-preview"
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
      </div>
      <MarkLabels summary={summary} />
      <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">
        {segmentExcerpt(segment) || '该片段没有可预览的文本。'}
      </p>
      {segments.length > 1 ? (
        <SegmentList
          marks={marks}
          segments={segments}
          onJumpToSegment={onJumpToSegment}
        />
      ) : null}
      {segments.length === 1 ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
          <span>点击左侧标记可定位到此处</span>
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
  marks,
  segments,
  onJumpToSegment
}: {
  marks: SegmentRailMarks;
  segments: SourceSegment[];
  onJumpToSegment: (segmentUid: string) => void;
}) {
  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      <div className="px-1 pb-0.5 text-[10px] text-muted-foreground">
        此位置有 {segments.length} 个片段 · 点击任一项定位
      </div>
      {segments.map((segment) => {
        const summary = summarizeSegmentRailMarks([segment], marks);

        return (
          <button
            className={cn('block w-full rounded-md border-l-2 bg-muted/55 px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              summary.bookmarks ? 'border-[var(--reader-ribbon)]' : summary.notes ? 'border-info' : summary.annotations ? 'border-warning' : 'border-transparent')}
            key={segment.uid}
            type="button"
            onClick={() => onJumpToSegment(segment.uid)}
          >
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>第 {segment.page_idx + 1} 页</span>
              <span>·</span>
              <span>{segmentTypeLabel(segment.segment_type)}</span>
            </div>
            <MarkLabels summary={summary} />
            <div className="line-clamp-1 text-[11px] text-foreground/75">
              {segmentExcerpt(segment) || '无可预览文本'}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MarkLabels({ summary }: { summary: SegmentRailMarkSummary }) {
  if (!summary.total) return null;
  return <div className="mb-1.5 flex flex-wrap gap-1 text-[11px] leading-4">
    {summary.bookmarks > 0 ? <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--reader-bookmark-surface)] px-1 text-[var(--reader-ribbon)]"><Bookmark className="size-3 fill-current" aria-hidden="true" />收藏 {summary.bookmarks} 处</span> : null}
    {summary.notes > 0 ? <span className="inline-flex items-center gap-1 rounded-sm bg-info-surface px-1 text-info"><StickyNote className="size-3" aria-hidden="true" />笔记 {summary.notes} 处</span> : null}
    {summary.annotations > 0 ? <span className="inline-flex items-center gap-1 rounded-sm bg-warning-surface px-1 text-warning"><MessageSquareText className="size-3" aria-hidden="true" />批注 {summary.annotations} 处</span> : null}
  </div>;
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
