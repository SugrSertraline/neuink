import { ChevronDown, ChevronUp, FileText, Folder } from 'lucide-react';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getEntryTagDragState, isEntryTagDropTargetActive, registerEntryTagDropTarget, subscribeEntryTagDrag } from '@/shared/lib/entryDragData';
import type { TagNode } from '../../library/utils/tagTree';

type TagNavigationActions = {
  onAssignEntryToTag: (entryId: string, tagPath: string) => Promise<unknown> | unknown;
  onOpen: (tagId: string) => void;
};

/** Navigation has its own expansion state; it never filters or sorts papers. */
export function LibraryTagNavigation({ nodes, nested, fill = false, papers = [], onOpenPaper, ...actions }: TagNavigationActions & {
  papers?: Array<{ id: string; title: string; pdfFileName?: string | null }>;
  onOpenPaper?: (id: string) => void;
  fill?: boolean;
  nodes: TagNode[];
  nested: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [columns, setColumns] = useState(4);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth > 0) setColumns(Math.max(1, Math.floor(element.clientWidth / 180)));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [nodes.length > 0]);

  if (!nodes.length && !fill) return null;
  const limit = columns * 2;
  const canExpand = !fill && nodes.length > limit;
  const visibleNodes = (fill || expanded) ? nodes : nodes.slice(0, limit);
  return (
    <nav aria-label="标签导航" className={cn('min-w-0 border-b px-3 py-1.5', fill ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0')}>
      {!fill && <div className="flex h-8 items-center justify-between gap-2 text-xs">
        <span className="font-medium">{nested ? '下级标签' : '标签'}<span className="ml-2 font-normal tabular-nums text-muted-foreground">{nodes.length}</span></span>
        {canExpand ? <Button size="xs" variant="ghost" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>
          {expanded ? '收起' : `展开全部 ${nodes.length} 个标签`}
          {expanded ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
        </Button> : null}
      </div>}
      <ul ref={listRef} id={listId} className={cn('grid content-start overflow-y-auto overscroll-contain', fill ? 'min-h-0 flex-1 gap-x-2 gap-y-1 p-1' : 'max-h-40 gap-x-3')} style={{ gridTemplateColumns: fill ? 'repeat(auto-fill, minmax(min(100%, 112px), 128px))' : `repeat(${columns}, minmax(0, 1fr))` }}>
        {visibleNodes.map(node => <li key={node.id} className="min-w-0"><LibraryTagNavigationItem node={node} {...actions} explorer={fill} selected={selected === node.id} onSelect={() => setSelected(node.id)} /></li>)}
        {fill && papers.map(paper => <li key={`paper:${paper.id}`} className="min-w-0">
          <Button variant="ghost" aria-label={`打开论文 ${paper.title}`} title={paper.title}
            aria-pressed={selected === `paper:${paper.id}`}
            className={cn('h-full min-h-28 w-full min-w-0 flex-col justify-start gap-1 whitespace-normal rounded-sm border border-transparent px-2 py-2 text-center hover:border-border hover:bg-accent/60', selected === `paper:${paper.id}` && 'border-primary/40 bg-accent')}
            onClick={() => setSelected(`paper:${paper.id}`)} onDoubleClick={() => onOpenPaper?.(paper.id)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onOpenPaper?.(paper.id); } }}>
            <FileText className="size-10 shrink-0 text-muted-foreground" strokeWidth={1.25} aria-hidden="true" />
            <span className="w-full whitespace-normal break-words text-[13px] font-normal leading-[18px] text-foreground [overflow-wrap:anywhere]">{paper.title}</span>
            <span className="mt-auto text-[11px] leading-4 text-muted-foreground">{paper.pdfFileName ? 'PDF 文献' : '论文条目'}</span>
          </Button>
        </li>)}
      </ul>
    </nav>
  );
}

export function LibraryTagNavigationItem({ node, onAssignEntryToTag, onOpen, explorer, selected, onSelect }: TagNavigationActions & { node: TagNode; explorer?: boolean; selected?: boolean; onSelect?: () => void }) {
  const targetRef = useRef<HTMLButtonElement>(null);
  const drag = useSyncExternalStore(subscribeEntryTagDrag, getEntryTagDragState, getEntryTagDragState);
  const dragOver = targetRef.current ? isEntryTagDropTargetActive(targetRef.current, drag) : false;
  useEffect(() => {
    const element = targetRef.current;
    if (!element) return;
    return registerEntryTagDropTarget({ element, onDrop: entryId => onAssignEntryToTag(entryId, node.path) });
  }, [node.path, onAssignEntryToTag]);

  return <Button ref={targetRef} size="default" variant="ghost" data-tag-id={node.id}
    aria-label={`打开标签 ${node.path}`} title={`进入标签：${node.path}；${node.count} 篇论文（含下级标签）`}
    className={cn('w-full min-w-0 justify-start gap-2 px-1.5 text-xs font-normal', explorer && 'h-full min-h-28 flex-col justify-start gap-1 whitespace-normal rounded-sm border border-transparent px-2 py-2 text-center hover:border-border hover:bg-accent/60', explorer && selected && 'border-primary/40 bg-accent text-accent-foreground', dragOver && 'bg-primary/10 outline outline-1 -outline-offset-1 outline-primary/40')}
    onClick={() => explorer ? onSelect?.() : onOpen(node.id)}
    onDoubleClick={() => { if (explorer) onOpen(node.id); }}
    onKeyDown={event => { if (explorer && event.key === 'Enter') { event.preventDefault(); onOpen(node.id); } }}
    aria-pressed={explorer ? Boolean(selected) : undefined}>
    <Folder className={cn('shrink-0', explorer ? 'size-10 fill-primary/15 text-primary' : 'size-3.5 text-muted-foreground')} strokeWidth={explorer ? 1.25 : 2} aria-hidden="true" />
    <span className={explorer ? 'w-full whitespace-normal break-words text-[13px] font-normal leading-[18px] text-foreground [overflow-wrap:anywhere]' : 'max-w-full truncate'}>{node.name}</span>
    <span className={cn('shrink-0 tabular-nums text-muted-foreground', explorer ? 'mt-auto text-[11px] leading-4' : 'ml-auto')} aria-label={`${node.count} 篇论文（含下级标签）`}>{explorer ? `${node.count} 篇论文` : node.count}</span>
  </Button>;
}
