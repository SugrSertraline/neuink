import { ChevronDown, ChevronUp, Folder } from 'lucide-react';
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
export function LibraryTagNavigation({ nodes, nested, ...actions }: TagNavigationActions & {
  nodes: TagNode[];
  nested: boolean;
}) {
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

  if (!nodes.length) return null;
  const limit = columns * 2;
  const canExpand = nodes.length > limit;
  const visibleNodes = expanded ? nodes : nodes.slice(0, limit);
  return (
    <nav aria-label="标签导航" className="min-w-0 shrink-0 border-b px-3 py-1.5">
      <div className="flex h-6 items-center justify-between gap-2 text-xs">
        <span className="font-medium">{nested ? '下级标签' : '标签'}<span className="ml-2 font-normal tabular-nums text-muted-foreground">{nodes.length}</span></span>
        {canExpand ? <Button size="xs" variant="ghost" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)}>
          {expanded ? '收起' : `展开全部 ${nodes.length} 个标签`}
          {expanded ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
        </Button> : null}
      </div>
      <ul ref={listRef} id={listId} className="grid max-h-40 gap-x-3 overflow-y-auto overscroll-contain" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {visibleNodes.map(node => <li key={node.id} className="min-w-0"><LibraryTagNavigationItem node={node} {...actions} /></li>)}
      </ul>
    </nav>
  );
}

export function LibraryTagNavigationItem({ node, onAssignEntryToTag, onOpen }: TagNavigationActions & { node: TagNode }) {
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
    className={cn('w-full min-w-0 justify-start gap-2 px-1.5 text-xs font-normal', dragOver && 'bg-primary/10 outline outline-1 -outline-offset-1 outline-primary/40')}
    onClick={() => onOpen(node.id)}>
    <Folder className="shrink-0 text-muted-foreground" size={14} aria-hidden="true" />
    <span className="truncate">{node.name}</span>
    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground" aria-label={`${node.count} 篇论文（含下级标签）`}>{node.count}</span>
  </Button>;
}
