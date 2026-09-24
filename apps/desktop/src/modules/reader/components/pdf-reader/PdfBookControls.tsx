import { useRef, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { scrollToPage } from './readerUtils';

export function PdfBookControls({ previousPage, nextPage, scrollRef, currentPage, pageCount, resumePageIdx, width }:
  { previousPage?: number; nextPage?: number; scrollRef: RefObject<HTMLDivElement>; currentPage: number; pageCount: number; resumePageIdx?: number | null; width?: number }) {
  const drag = useRef<{ x: number; page: number; pointerId: number } | null>(null);
  const suppressClick = useRef(false);
  return <div className="pdf-book-controls" aria-label="书页翻阅" style={{ width: width === undefined ? undefined : width + 88 }}>
    {([['previous', previousPage, '向前翻页'], ['next', nextPage, '向后翻页']] as const).map(([side, page, label]) =>
      <Button key={side} className="pdf-book-corner" data-side={side} size="icon-sm" variant="plain" disabled={page === undefined}
        aria-label={label} title={`${label}；也可以向内拖动翻页`} type="button"
        onPointerDown={event => {
          if (event.button !== 0 || page === undefined) return;
          drag.current = { x: event.clientX, page, pointerId: event.pointerId };
          suppressClick.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={event => {
          const start = drag.current; drag.current = null;
          if (!start) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          const distance = (event.clientX - start.x) * (side === 'previous' ? 1 : -1);
          if (distance > 32) { suppressClick.current = true; scrollToPage(start.page, scrollRef.current); }
          else if (Math.abs(event.clientX - start.x) > 8) suppressClick.current = true;
        }}
        onPointerCancel={() => { drag.current = null; suppressClick.current = true; }}
        onKeyDown={event => {
          if (event.key === 'Escape') { drag.current = null; suppressClick.current = true; }
          else if (event.key === 'Enter' || event.key === ' ') suppressClick.current = false;
        }}
        onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          if (page !== undefined) scrollToPage(page, scrollRef.current);
        }}>
        {side === 'previous' ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
      </Button>)}
    <span className="pdf-book-folio" aria-live="polite">{currentPage} / {pageCount}</span>
    {resumePageIdx !== undefined && resumePageIdx !== null && resumePageIdx >= 0 && resumePageIdx < pageCount ?
      <Button className="pdf-reading-ribbon" size="xs" variant="plain" title={`阅读书签：上次读到第 ${resumePageIdx + 1} 页`}
        aria-label={`回到上次阅读位置，第 ${resumePageIdx + 1} 页`} onClick={() => scrollToPage(resumePageIdx, scrollRef.current)}>
        <Bookmark size={12} aria-hidden="true" />{resumePageIdx + 1}
      </Button> : null}
  </div>;
}
