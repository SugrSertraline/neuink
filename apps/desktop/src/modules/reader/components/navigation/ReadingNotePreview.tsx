import { useRef, useState, type ReactElement, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import type { SourceSegment } from '@/shared/types/domain';

/** Preview state is local to the row; its body is the only preview scroll owner. */
export function ReadingNotePreview({ children, noteText, segment, entryId, workspaceRoot, onNavigate }: {
  children: ReactElement;
  noteText: string;
  segment?: SourceSegment;
  entryId: string;
  workspaceRoot: string | null;
  onNavigate: () => void;
}) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [view, setView] = useState<'note' | 'source'>(noteText ? 'note' : 'source');
  const currentView = noteText ? view : 'source';
  const body = useRef<HTMLDivElement>(null);
  const preview = (bodyRef?: RefObject<HTMLDivElement>) => <ReadingNotePreviewBody noteText={noteText} segment={segment}
    entryId={entryId} workspaceRoot={workspaceRoot} view={currentView} onViewChange={setView} bodyRef={bodyRef}
    onNavigate={() => { setPinned(false); setHoverOpen(false); onNavigate(); }} />;
  return <Popover open={pinned} onOpenChange={next => { setPinned(next); setHoverOpen(false); }}>
    <HoverCard open={hoverOpen && !pinned} onOpenChange={setHoverOpen}>
    <HoverCardTrigger asChild onKeyDown={event => {
      if (event.key === 'ArrowRight' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault(); setHoverOpen(false); setPinned(true);
      }
    }}>{children}</HoverCardTrigger>
    <PopoverTrigger asChild><Button size="xs" variant="ghost" className="shrink-0 text-muted-foreground"
      aria-label={segment ? `预览第 ${segment.page_idx + 1} 页的笔记与原文` : '预览失效位置的笔记'}
      >预览</Button></PopoverTrigger>
    <HoverCardContent side="bottom" align="start" sideOffset={8} className="flex w-96 flex-col overflow-hidden p-0">
      {preview()}
    </HoverCardContent>
    </HoverCard>
    <PopoverContent viewportAligned side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-label="笔记与收藏预览"
      className="max-h-[min(28rem,var(--radix-popover-content-available-height))] w-96 max-w-[var(--radix-popover-content-available-width)] gap-0 overflow-hidden p-0"
      onOpenAutoFocus={event => { event.preventDefault(); body.current?.focus({ preventScroll: true }); }}>
      {preview(body)}
    </PopoverContent>
  </Popover>;
}

function ReadingNotePreviewBody({ noteText, segment, entryId, workspaceRoot, view, onViewChange, onNavigate, bodyRef }: {
  noteText: string; segment?: SourceSegment; entryId: string; workspaceRoot: string | null;
  view: 'note' | 'source'; onViewChange: (view: 'note' | 'source') => void; onNavigate: () => void;
  bodyRef?: RefObject<HTMLDivElement>;
}) {
  return <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <span className="mr-auto text-xs font-medium">{segment ? `第 ${segment.page_idx + 1} 页` : '原文位置已失效'}</span>
          {noteText ? <div role="group" aria-label="预览内容" className="flex items-center gap-1">
            <Button size="xs" variant={view === 'note' ? 'secondary' : 'ghost'} aria-pressed={view === 'note'} onClick={() => onViewChange('note')}>笔记</Button>
            <Button size="xs" variant={view === 'source' ? 'secondary' : 'ghost'} aria-pressed={view === 'source'} onClick={() => onViewChange('source')}>对应原文</Button>
          </div> : <span className="text-xs text-muted-foreground">对应原文</span>}
        </div>
        <div key={view} ref={bodyRef} role="region" aria-label={view === 'note' ? '笔记预览正文' : '对应原文预览正文'} tabIndex={0}
          className="min-h-0 max-h-72 overflow-y-auto overscroll-contain break-words p-3 text-xs leading-5 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring">
          {view === 'note' ? <p className="whitespace-pre-wrap">{noteText}</p> : segment ?
            <SourceSnapshotPreview compact allowScroll={false} markdown={segment.markdown ?? segment.text} relatedImagePath={segment.asset_path}
              segmentType={segment.segment_type} sourceEntryId={entryId} workspaceRoot={workspaceRoot} /> :
            <p className="text-muted-foreground">原文段落已不存在，笔记内容仍保留。</p>}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2">
          <span className="text-[11px] text-muted-foreground">移入可滚动 · Esc 关闭</span>
          <Button size="xs" variant="outline" disabled={!segment} onClick={onNavigate}>定位原文</Button>
        </div>
      </div>;
}
