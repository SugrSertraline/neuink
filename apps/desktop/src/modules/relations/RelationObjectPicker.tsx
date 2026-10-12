import { useEffect, useRef, useState } from 'react';
import { List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RelationIcon, relationNodeLabel } from './RelationIcon';
import type { RelationNode } from './relationGraph';

export function RelationObjectPicker({ nodes, active, onSelect }: { nodes: RelationNode[]; active: boolean; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const matches = nodes.filter(node => `${relationNodeLabel(node)} ${node.subtitle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => { if (!active) setOpen(false); }, [active]);
  const select = (id: string) => { setOpen(false); onSelect(id); };
  return <Popover open={open && active} onOpenChange={value => { setOpen(value); if (value) setQuery(''); }}><PopoverTrigger asChild>
    <Button size="sm" variant="ghost"><List size={14} />查找对象</Button>
  </PopoverTrigger><PopoverContent viewportAligned align="end" aria-label="关系对象列表" className="relation-object-picker gap-2"
    onKeyDown={event => {
      if (!(event.target instanceof HTMLInputElement) || !matches.length) return;
      if (event.key === 'Enter') { event.preventDefault(); select(matches[0].id); }
      if (event.key === 'ArrowDown') { event.preventDefault(); list.current?.querySelector('button')?.focus(); }
    }}>
    <SearchInput label="查找关系对象" placeholder="名称或完整标签路径" value={query} onValueChange={setQuery} />
    <div className="text-[11px] text-muted-foreground">{matches.length} 个对象 · Enter 打开首项</div>
    <div ref={list} className="max-h-64 overflow-y-auto overscroll-contain" onKeyDown={event => {
      const buttons = [...(list.current?.querySelectorAll('button') ?? [])];
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? Math.min(buttons.length - 1, index + 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
      if (next !== null && buttons[next]) { event.preventDefault(); event.stopPropagation(); buttons[next].focus(); }
    }}>
      {matches.map(node => <Button key={node.id} variant="plain" aria-label={relationNodeLabel(node)} title={node.subtitle || node.title}
        className="h-auto w-full justify-start gap-2 px-2 py-2 text-left text-xs" onClick={() => select(node.id)}>
        <RelationIcon kind={node.kind} /><span className="min-w-0 flex-1"><span className="block truncate">{node.title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{node.kind === 'tag' ? node.subtitle : node.kind === 'entry' ? '条目' : node.subtitle}</span></span>
      </Button>)}
      {!matches.length ? <p className="p-3 text-center text-xs text-muted-foreground">没有匹配的对象，试试其他名称。</p> : null}
    </div>
  </PopoverContent></Popover>;
}
