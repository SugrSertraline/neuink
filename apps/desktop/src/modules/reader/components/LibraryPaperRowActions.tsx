import { useState, type ComponentProps, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LibraryPaperMenuItems } from './LibraryPaperMenuItems';

type Props = Omit<ComponentProps<typeof LibraryPaperMenuItems>, 'mode' | 'renderInlineActions'> & { width: number };

// 28px shared icon buttons, 6px gaps, 16px cell padding and a border allowance.
export function visibleActionCount(width: number, count: number) {
  const slots = Math.max(1, Math.floor((width - 18 + 6) / 34));
  return count <= slots ? count : Math.max(0, slots - 1);
}

/** Width belongs to the table; the popover owns visibility and overflow scrolling. */
export function LibraryPaperRowActions({ width, ...props }: Props) {
  return <div role="group" aria-label={`条目操作：${props.entry.title}`} className="flex min-w-0 items-center justify-center"
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
    <LibraryPaperMenuItems {...props} mode="inline" renderInlineActions={items => <ResponsiveActions width={width} title={props.entry.title} items={items} />} />
  </div>;
}

function ResponsiveActions({ width, title, items }: { width: number; title: string; items: (mode: 'inline' | 'panel') => ReactNode[] }) {
  const [frozenCount, setFrozenCount] = useState<number | null>(null);
  const inlineItems = items('inline');
  const visible = Math.min(frozenCount ?? visibleActionCount(width, inlineItems.length), inlineItems.length);
  return <div className="flex flex-nowrap items-center justify-center gap-1.5 whitespace-nowrap">
    {inlineItems.slice(0, visible)}
    {visible < inlineItems.length && <Popover open={frozenCount !== null} onOpenChange={open => setFrozenCount(open ? visible : null)}>
      <PopoverTrigger asChild><Button size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground hover:text-foreground" title="更多" aria-label={`更多操作：${title}`}><MoreHorizontal className="size-4" aria-hidden="true" /></Button></PopoverTrigger>
      <PopoverContent align="end" viewportAligned className="w-56 max-h-80 overflow-y-auto p-1" aria-label="更多条目操作">
        <div className="flex flex-col gap-1">{items('panel').slice(visible)}</div>
      </PopoverContent>
    </Popover>}
  </div>;
}
