import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PaperRecord } from '../research/paperPresentation';

const PAGE_SIZE = 20;

export function PaperCandidates({ records, label, renderRecord }: {
  records: PaperRecord[];
  label: string;
  renderRecord: (record: PaperRecord) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const listId = useId();
  const summary = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const navigation = useRef<'keyboard' | 'pointer' | null>(null);
  const lastPage = Math.max(0, Math.ceil(records.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);

  // Clamp rendering immediately, then remember it so later growth cannot restore a stale page.
  useEffect(() => { if (page !== currentPage) setPage(currentPage); }, [page, currentPage]);
  useLayoutEffect(() => {
    const input = navigation.current;
    navigation.current = null;
    if (!input || !expanded) return;
    summary.current?.scrollIntoView?.({ block: 'start', inline: 'nearest', behavior: 'instant' });
    if (input === 'keyboard') {
      list.current?.querySelector<HTMLElement>('a[href], button:not(:disabled), [tabindex="0"]')?.focus({ preventScroll: true });
    }
  }, [currentPage, expanded]);

  function changePage(event: MouseEvent<HTMLButtonElement>, next: number) {
    if (next < 0 || next > lastPage || next === currentPage) return;
    navigation.current = event.detail === 0 ? 'keyboard' : 'pointer';
    setPage(next);
  }
  const pagingButton = (direction: -1 | 1) => {
    const text = direction === -1 ? '上一页候选' : '下一页候选';
    return <Tooltip><TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon-sm" title={text} aria-label={text} aria-controls={listId}
        disabled={direction === -1 ? currentPage === 0 : currentPage === lastPage}
        onClick={event => changePage(event, currentPage + direction)}>
        {direction === -1 ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
      </Button>
    </TooltipTrigger><TooltipContent>{text}</TooltipContent></Tooltip>;
  };

  return <details className="mt-3 min-w-0" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary ref={summary} className="cursor-pointer text-sm text-muted-foreground scroll-mt-3">{label}（{records.length}）</summary>
    {expanded && <>
      <p className="mt-1 text-xs text-muted-foreground">候选不等于推荐，会议归属和相关性以可核验信息为准。</p>
      <div ref={list} id={listId} aria-label="本页检索候选">
        {records.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(record => renderRecord(record))}
      </div>
      {lastPage > 0 && <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          第 {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, records.length)} 篇，共 {records.length} 篇
        </span>
        <nav aria-label="候选分页" className="flex shrink-0 items-center gap-1">
          {pagingButton(-1)}
          <span role="status" aria-label="候选页码" aria-live="polite" aria-atomic="true" className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {currentPage + 1} / {lastPage + 1}
          </span>
          {pagingButton(1)}
        </nav>
      </div>}
    </>}
  </details>;
}
