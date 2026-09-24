import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import type { SourceSegment } from '@/shared/types/domain';
import { useSegmentBookmarks } from '../SegmentBookmarks';
import { getSegmentNoteVisibleText } from '../pdf-reader/segmentNoteLimits';
import { segmentTarget, useReadingNavigation } from './ReadingNavigation';
import { ReadingNotePreview } from './ReadingNotePreview';

export function ReadingNavigationControls({ segments, entryId, workspaceRoot }: { segments: SourceSegment[]; entryId: string; workspaceRoot: string | null }) {
  const navigation = useReadingNavigation();
  const bookmarks = useSegmentBookmarks();
  const [open, setOpen] = useState(false);
  const [onlyBookmarks, setOnlyBookmarks] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const records = useMemo(() => {
    const byUid = new Map(segments.map(segment => [segment.uid, segment]));
    return (bookmarks?.notes ?? []).filter(note => note.bookmarked || getSegmentNoteVisibleText(note.text).trim())
      .map(note => ({ note, segment: byUid.get(note.segment_uid) }))
      .filter(({note, segment}) => (!onlyBookmarks || note.bookmarked) &&
        `${getSegmentNoteVisibleText(note.text)} ${segment?.text ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => (a.segment?.page_idx ?? Infinity) - (b.segment?.page_idx ?? Infinity));
  }, [bookmarks?.notes, onlyBookmarks, query, segments]);
  if (!navigation) return null;
  return <div className="flex shrink-0 items-center gap-0.5" aria-label="阅读定位">
    <Button size="icon-sm" variant="ghost" aria-label="返回阅读位置" title="返回阅读位置（Alt + ←）" disabled={!navigation.canBack} onClick={navigation.back}><ArrowLeft size={14} /></Button>
    <Button size="icon-sm" variant="ghost" aria-label="前进阅读位置" title="前进阅读位置（Alt + →）" disabled={!navigation.canForward} onClick={navigation.forward}><ArrowRight size={14} /></Button>
    {bookmarks ? <Popover open={open} onOpenChange={value => { setOpen(value); setError(''); }}>
      <PopoverTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="笔记定位" title="笔记与收藏位置"><Bookmark size={14} /></Button></PopoverTrigger>
      <PopoverContent viewportAligned align="start" collisionPadding={12} className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-hidden p-2">
        <div className="flex shrink-0 items-center gap-1"><span className="mr-auto px-1 text-xs font-medium">笔记定位</span>
          <Button size="xs" variant={!onlyBookmarks ? 'secondary' : 'ghost'} aria-pressed={!onlyBookmarks} onClick={() => setOnlyBookmarks(false)}>全部</Button>
          <Button size="xs" variant={onlyBookmarks ? 'secondary' : 'ghost'} aria-pressed={onlyBookmarks} onClick={() => setOnlyBookmarks(true)}>收藏</Button></div>
        <Input className="shrink-0" aria-label="搜索笔记位置" placeholder="搜索笔记或原文" value={query} onChange={e => setQuery(e.target.value)} />
        {error ? <p role="alert" className="shrink-0 px-1 text-xs text-destructive">{error}</p> : null}
        <div className="min-h-0 max-h-72 overflow-y-auto overscroll-contain">
          {!records.length ? <p className="p-3 text-xs text-muted-foreground">{query ? '没有匹配的笔记。' : onlyBookmarks ? '右键原文选择“记住此处”，即可收藏位置。' : '保存片段笔记后会显示在这里，也可右键“记住此处”。'}</p> : null}
          {records.map(({ note, segment }) => {
            const navigate = () => {
              if (segment && navigation.navigate(segmentTarget(segment))) { setOpen(false); setError(''); }
              else setError('此位置在当前视图中被隐藏，请恢复隐藏内容后重试。');
            };
            return <div key={note.segment_uid} className="flex items-center gap-1 border-b last:border-0">
            <ReadingNotePreview noteText={getSegmentNoteVisibleText(note.text)} segment={segment} entryId={entryId} workspaceRoot={workspaceRoot} onNavigate={navigate}>
            <button type="button" disabled={!segment} className="min-w-0 flex-1 rounded-sm px-2 py-2 text-left text-xs hover:bg-muted focus-visible:outline focus-visible:outline-ring disabled:opacity-60"
              aria-label={segment ? `定位第 ${segment.page_idx + 1} 页${note.bookmarked ? '的收藏' : '的笔记'}` : '原文位置已失效'} onClick={navigate}>
              <span className="block font-medium">{segment ? `第 ${segment.page_idx + 1} 页` : '原文位置已失效'}{note.bookmarked ? ' · 收藏' : ''}</span>
              <span className="mt-1 line-clamp-2">{getSegmentNoteVisibleText(note.text) || segment?.text || '已保存的位置'}</span>
            </button></ReadingNotePreview>
            <Button size="icon-xs" variant="ghost" aria-label={note.bookmarked ? '取消收藏位置' : '收藏笔记位置'} title={note.bookmarked ? '取消收藏位置' : '收藏笔记位置'} aria-pressed={Boolean(note.bookmarked)} disabled={bookmarks.pending.has(note.segment_uid) || (!segment && !note.bookmarked)} onClick={() => void bookmarks.set(note.segment_uid, !note.bookmarked)}>
              {note.bookmarked ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
            </Button>
          </div>; })}
        </div>
      </PopoverContent>
    </Popover> : null}
  </div>;
}
