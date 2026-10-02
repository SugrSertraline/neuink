import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type ComposerPickerKind = 'tag' | 'entry' | 'pdf' | 'note';
export type ComposerPickerItem<T> = {
  id: string;
  kind: ComposerPickerKind;
  label: string;
  description: string;
  searchText: string;
  value: T;
};

const kinds: Array<{ kind: ComposerPickerKind; label: string }> = [
  { kind: 'tag', label: '标签' }, { kind: 'entry', label: '条目' },
  { kind: 'pdf', label: 'PDF' }, { kind: 'note', label: '笔记' }
];

/** Point-and-click context selection. The editor owns the inserted mention. */
export function AssistantComposerTargetPicker<T>({ items, disabled, onSelect }: {
  items: ComposerPickerItem<T>[];
  disabled: boolean;
  onSelect: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ComposerPickerKind>('tag');
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(false);
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter(item => item.kind === kind && (!normalized || item.searchText.toLocaleLowerCase().includes(normalized)));
  }, [items, kind, query]);
  const virtualizer = useVirtualizer({ count: matches.length, getScrollElement: () => scrollRef.current,
    estimateSize: () => 48, initialRect: { width: 384, height: 224 }, overscan: 5 });
  const choose = (value: T) => { selectedRef.current = true; onSelect(value); setOpen(false); setQuery(''); };
  return <Popover open={open && !disabled} onOpenChange={value => { setOpen(value); if (!value) setQuery(''); }}>
    <PopoverTrigger asChild><Button data-guide="context-picker" size="xs" variant="outline" type="button" disabled={disabled} aria-label="选择元素">选择元素</Button></PopoverTrigger>
    <PopoverContent viewportAligned align="start" side="top" className="w-[min(24rem,calc(100vw-2rem))] min-w-0 gap-2 p-2"
      onCloseAutoFocus={event => { if (selectedRef.current) event.preventDefault(); selectedRef.current = false; }}>
      <div className="text-xs font-medium">选择上下文类型和内容</div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="上下文类型">
        {kinds.map(option => <Button key={option.kind} size="xs" type="button" variant={kind === option.kind ? 'secondary' : 'ghost'}
          aria-pressed={kind === option.kind} onClick={() => { setKind(option.kind); setQuery(''); virtualizer.scrollToOffset(0); inputRef.current?.focus(); }}>
          {option.label}
        </Button>)}
      </div>
      <Input ref={inputRef} aria-label="搜索所选类型" placeholder={`搜索${kinds.find(option => option.kind === kind)?.label}`} value={query}
        onChange={event => { setQuery(event.target.value); virtualizer.scrollToOffset(0); }} />
      <div ref={scrollRef} className="h-56 min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]" role="listbox" aria-label="可选内容">
        {matches.length ? <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(row => {
            const item = matches[row.index];
            return <button key={item.id} type="button" role="option" aria-selected="false"
              className="absolute left-0 flex h-12 w-full min-w-0 flex-col justify-center rounded-sm px-2 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ transform: `translateY(${row.start}px)` }} onClick={() => choose(item.value)}>
              <span className="block w-full truncate font-medium" title={item.label}>{item.label}</span>
              <span className="block w-full truncate text-muted-foreground" title={item.description}>{item.description}</span>
            </button>;
          })}
        </div> : <p className="p-2 text-xs text-muted-foreground">没有匹配内容。请换个名称或类型。</p>}
      </div>
    </PopoverContent>
  </Popover>;
}
