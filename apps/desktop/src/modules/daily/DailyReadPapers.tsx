import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ArrowUpRight } from 'lucide-react';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { EntryReadingState } from '@/shared/types/domain';
import { formatReadingDuration, getReadingProgress } from '@/modules/reader/components/libraryReading';

export function DailyReadPapers({ papers, hasEntries, onOpenEntry, onOpenLibrary }: {
  papers: { entry: LibraryEntry; state: EntryReadingState; duration: number }[];
  hasEntries: boolean; onOpenEntry: (id: string) => void; onOpenLibrary: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return <section aria-label="当日阅读论文" className="min-w-0 @container/read-papers">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-sm font-medium">当日阅读论文</h2>
      {papers.length > 4 ? <Button size="xs" variant="plain" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        {expanded ? '收起' : `展开全部 ${papers.length} 篇`}
      </Button> : null}
    </div>
    {papers.length ? <ul className="grid min-w-0 grid-cols-1 gap-2 @min-[640px]/read-papers:grid-cols-2">
      {(expanded ? papers : papers.slice(0, 4)).map(({ entry, state, duration }) => {
        const progress = getReadingProgress(state);
        return <li key={entry.id} className="group min-w-0 overflow-hidden rounded-md border border-border/70 bg-background transition-colors hover:border-primary/35">
          <Button variant="plain" className="h-auto w-full min-w-0 items-start justify-start gap-3 whitespace-normal rounded-none px-3 py-2.5 text-left"
            aria-label={`继续阅读 ${entry.title}`} title={entry.title} onClick={() => onOpenEntry(entry.id)}>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] font-medium leading-5">{entry.title}</span>
              <span className="mt-1 block truncate text-[11px] font-normal text-muted-foreground">{(entry.tags ?? []).slice(0, 2).join(' · ') || '阅读记录'}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-xs font-medium tabular-nums text-primary">{formatReadingDuration(duration)}</span>
              <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">继续阅读<ArrowUpRight size={12} aria-hidden="true" /></span>
            </span>
          </Button>
          <div className="flex items-center gap-2 border-t border-border/50 bg-muted/20 px-3 py-1.5">
            <span className="shrink-0 text-[10px] text-muted-foreground">已浏览</span>
            <Progress value={progress} aria-label={`${entry.title}浏览进度`} className="h-1 flex-1" />
            <span className="text-[10px] tabular-nums text-muted-foreground">{progress}%</span>
          </div>
        </li>;
      })}
    </ul> : <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <p>{hasEntries ? '这一天还没有阅读记录。' : '资料库还没有论文。'}</p>
      <Button size="xs" variant="link" onClick={onOpenLibrary}>{hasEntries ? '去条目库选一篇论文' : '去条目库添加论文'}</Button>
    </div>}
  </section>;
}
