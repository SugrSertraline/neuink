import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Eye, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LibraryPaperContextMenu } from './LibraryPaperContextMenu';
import type { LibraryPaperCollectionProps } from './LibraryPaperTable';
import { getReadingProgress, formatReadingDuration } from './libraryReading';
import { AssetSummary, StatusBadge } from './EntryDisplay';
import { BookCover } from './book/BookCover';

const ROW_HEIGHT = 340;

/** A presentation of the existing filtered collection, with no data or action ownership. */
export function LibraryPaperShelf(props: LibraryPaperCollectionProps) {
  const { active, entries, status, emptyMessage, readingStates, selectedEntryId, draggingEntryId, getRowProps } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const [columns, setColumns] = useState(3);
  useLayoutEffect(() => {
    if (!active || !scrollRef.current) return;
    const element = scrollRef.current;
    const resize = () => setColumns(Math.max(1, Math.floor((element.clientWidth - 24) / 200)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);

  const rowCount = Math.ceil(entries.length / columns);
  const virtual = entries.length > 120;
  const rows = useVirtualizer({ count: rowCount, getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT, overscan: 3, enabled: active && virtual });
  const visibleRows = virtual ? rows.getVirtualItems().map(row => ({ index: row.index, start: row.start }))
    : Array.from({ length: rowCount }, (_, index) => ({ index, start: index * ROW_HEIGHT }));

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const book = scrollRef.current?.querySelector<HTMLElement>(`[data-book-index="${pendingFocus.current}"]`);
    if (book) { book.focus({ preventScroll: true }); pendingFocus.current = null; }
  });

  const navigate = (index: number) => {
    const target = Math.max(0, Math.min(entries.length - 1, index));
    const book = scrollRef.current?.querySelector<HTMLElement>(`[data-book-index="${target}"]`);
    if (book) { book.focus({ preventScroll: true }); book.scrollIntoView({ block: 'nearest' }); }
    else {
      // Keep a keyboard destination when a virtual row is not mounted yet.
      pendingFocus.current = target;
      scrollRef.current?.focus({ preventScroll: true });
      rows.scrollToIndex(Math.floor(target / columns), { align: 'auto' });
    }
  };

  return <div ref={scrollRef} className="library-paper-shelf" aria-label="论文书架" role="region" tabIndex={-1}>
    {status !== 'ready' || !entries.length ? <p role={status === 'error' ? 'alert' : 'status'}
      className={cn('p-8 text-center text-sm', status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
      {status === 'loading' ? '正在打开条目库...' : status === 'error' ? '无法加载标签和论文，请重新打开工作区后重试。' : emptyMessage}
    </p> : <div role="list" aria-label="书架论文" className="library-shelf-rows" style={{ height: rowCount * ROW_HEIGHT }}>
      {visibleRows.map(row => <div key={row.index} role="presentation" className="library-shelf-row"
        style={{ top: row.start, height: ROW_HEIGHT, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {entries.slice(row.index * columns, (row.index + 1) * columns).map((entry, offset) => {
          const index = row.index * columns + offset;
          const rowProps = getRowProps(entry);
          const state = readingStates[entry.id];
          const progress = getReadingProgress(state);
          const hasReading = Boolean(state && (state.total_active_ms > 0 || state.current_page_idx !== null));
          const progressLabel = progress >= 100 ? '已读完' : hasReading ? `已读 ${progress}%` : '未开始阅读';
          return <LibraryPaperContextMenu key={entry.id} entry={entry} {...props}>
            <div {...rowProps} role="listitem" tabIndex={0} aria-label={entry.title}
              aria-posinset={index + 1} aria-setsize={entries.length} data-book-index={index}
              onKeyDown={event => {
                if (event.target === event.currentTarget) {
                  const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1
                    : event.key === 'ArrowDown' ? index + columns : event.key === 'ArrowUp' ? index - columns
                    : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : null;
                  if (next !== null) { event.preventDefault(); navigate(next); return; }
                }
                rowProps.onKeyDown?.(event);
              }}
              data-entry-id={entry.id} data-allow-context-menu="true" data-state={entry.id === selectedEntryId ? 'selected' : undefined}
              className={cn('library-shelf-entry', entry.id === draggingEntryId && 'is-dragging')}>
              <BookCover id={entry.id} title={entry.title} topic={entry.tags[0]?.split('/').slice(-1)[0] || '研究札记'} bookmark={progress > 0} enabled={active && !draggingEntryId}/>
              <div className="library-book-caption">
                <div className="library-book-progress" title={`${progressLabel} · ${formatReadingDuration(state?.total_active_ms ?? 0)}`}>
                  <span>{progressLabel}</span>
                  <span className="library-book-meter" role="progressbar" aria-label={`${entry.title} 阅读进度`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ '--reading-progress': `${progress}%` } as CSSProperties} />
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <div className="min-w-0 flex-1"><AssetSummary entry={entry} compact /></div>
                  <Button variant="ghost" size="icon-xs" aria-label={`打开 ${entry.title}`} title="打开条目详情"
                    onClick={event => { event.stopPropagation(); props.onOpen(entry.id); }}><Eye aria-hidden="true" /></Button>
                  <Button variant="ghost" size="icon-xs" aria-label={`在右侧打开 ${entry.title}`} title="在右侧分屏打开"
                    onClick={event => { event.stopPropagation(); props.onOpenInSidePane(entry.id); }}><PanelRight aria-hidden="true" /></Button>
                </div>
                {entry.status !== 'Parsed' && entry.status !== 'No PDF' ? <StatusBadge status={entry.status} /> : null}
              </div>
            </div>
          </LibraryPaperContextMenu>;
        })}
      </div>)}
    </div>}
  </div>;
}
