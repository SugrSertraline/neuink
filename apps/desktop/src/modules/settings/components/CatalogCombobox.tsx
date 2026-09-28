import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

export type CatalogOption = { key: string; content: ReactNode; select: () => void };
/** The original input owns focus/query; the list owns scrolling. Portal stays inside the
 * surrounding Dialog's scroll lock, without a second modal trapping focus away from the input.
 * No global handlers: Radix and Virtual clean up their listeners on close/unmount.
 */
export function CatalogCombobox({ value, label, buttonLabel, placeholder, inputId, busy, options, onInput, empty, resetKey }: {
  value: string; label: string; buttonLabel: string; placeholder: string; inputId?: string; busy: boolean;
  options: (query: string) => CatalogOption[]; onInput?: (text: string) => void; empty?: string; resetKey?: string;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState<string>();
  const [active, setActive] = useState(0);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null), anchor = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const listId = useId();
  useEffect(() => { setContainer(input.current?.closest<HTMLElement>('[data-slot="dialog-content"]') ?? anchor.current); }, []);
  useEffect(() => { if (busy) { setOpen(false); setQuery(undefined); } }, [busy]);
  useEffect(() => { setOpen(false); setQuery(undefined); setActive(0); }, [resetKey]);
  const rows = useMemo(() => options(query ?? ''), [options, query]);
  const selected = Math.min(active, rows.length - 1);
  const virtual = useVirtualizer({ count: rows.length, enabled: open, useFlushSync: false, getScrollElement: () => scrollElement,
    estimateSize: () => 72, getItemKey: i => rows[i].key, overscan: 3,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...(selected >= 0 ? [selected] : [])])].sort((a, b) => a - b),
  });
  const close = () => { setOpen(false); setQuery(undefined); setActive(0); };
  const choose = (index: number) => { if (!busy && !input.current?.matches(':disabled') && rows[index]) { rows[index].select(); close(); } };
  const show = () => { if (!busy && !input.current?.matches(':disabled')) { setOpen(true); setActive(0); } };
  return <Popover open={open && Boolean(container)} onOpenChange={next => next ? show() : close()}>
    <PopoverAnchor asChild><div ref={anchor} className="flex min-w-0 items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/50">
      <Input ref={input} id={inputId} role="combobox" aria-label={label} aria-expanded={open} aria-autocomplete="list"
        aria-controls={open ? listId : undefined} aria-activedescendant={open && selected >= 0 ? `${listId}-${selected}` : undefined}
        className="min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0" disabled={busy} autoComplete="off" spellCheck={false}
        placeholder={placeholder} value={query ?? value} onFocus={event => { show(); event.target.select(); }} onClick={show}
        onChange={event => { setQuery(event.target.value); onInput?.(event.target.value); show(); virtual.scrollToOffset(0); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); return; }
          if (event.key === 'Tab') { close(); return; }
          if (event.key === 'Enter' && open) { event.preventDefault(); choose(selected); return; }
          const pageSize = Math.max(1, Math.floor((scrollElement?.clientHeight || 256) / 72));
          let next: number;
          switch (event.key) {
            case 'ArrowDown': next = open ? selected + 1 : 0; break;
            case 'ArrowUp': next = open ? selected - 1 : rows.length - 1; break;
            case 'PageDown': next = selected + pageSize; break;
            case 'PageUp': next = selected - pageSize; break;
            case 'Home': if (!event.ctrlKey) return; next = 0; break;
            case 'End': if (!event.ctrlKey) return; next = rows.length - 1; break;
            default: return;
          }
          event.preventDefault(); setOpen(true); next = Math.max(0, Math.min(next, rows.length - 1)); setActive(next); virtual.scrollToIndex(next, { align: 'auto' });
        }} />
      <Button type="button" variant="ghost" tabIndex={-1} disabled={busy} aria-label={buttonLabel} aria-expanded={open}
        className="shrink-0 rounded-l-none border-l" onMouseDown={event => event.preventDefault()}
        onClick={() => { if (open) close(); else { input.current?.focus(); show(); } }}><ChevronsUpDown /></Button>
    </div></PopoverAnchor>
    <PopoverContent role="presentation" container={container} viewportAligned align="start" collisionBoundary={container}
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      onInteractOutside={event => { if (anchor.current?.contains(event.target as Node)) event.preventDefault(); }}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      className="max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-content-available-width)] overflow-hidden p-1">
      <div ref={setScrollElement} role="listbox" id={listId} aria-label={label} className="min-h-0 max-h-[32rem] overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin]"
        onMouseDown={event => event.preventDefault()}>
        {!rows.length && <p className="p-2 text-xs text-muted-foreground">{empty ?? '没有匹配项'}</p>}
        <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
          {virtual.getVirtualItems().map(item => <Button key={item.key} type="button" variant="ghost" role="option" tabIndex={-1}
            id={`${listId}-${item.index}`} aria-selected={selected === item.index} aria-posinset={item.index + 1} aria-setsize={rows.length}
            className="justify-start whitespace-normal px-2 text-left font-normal aria-selected:bg-accent aria-selected:text-accent-foreground"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: item.size, transform: `translateY(${item.start}px)` }}
            onPointerMove={() => setActive(item.index)} onClick={() => choose(item.index)}>{rows[item.index].content}</Button>)}
        </div>
      </div>
    </PopoverContent>
  </Popover>;
}
