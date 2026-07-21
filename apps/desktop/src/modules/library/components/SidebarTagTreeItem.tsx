import { ChevronDown, ChevronRight, Hash } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import {
  getEntryTagDragState,
  isEntryTagDropTargetActive,
  registerEntryTagDropTarget,
  subscribeEntryTagDrag
} from '@/shared/lib/entryDragData';

import type { TagNode } from '../utils/tagTree';

type SidebarTagTreeItemProps = {
  activeTag: string | null;
  node: TagNode;
  onAssignEntryToTag: (entryId: string, tagPath: string) => Promise<unknown> | unknown;
  onSelectTag: (tag: string | null) => void;
};

export function SidebarTagTreeItem({ activeTag, node, onAssignEntryToTag, onSelectTag }: SidebarTagTreeItemProps) {
  const [open, setOpen] = useState(true);
  const [dragState, setDragState] = useState(getEntryTagDragState);
  const targetRef = useRef<HTMLDivElement>(null);
  const active = activeTag === node.id;
  const hasChildren = node.children.length > 0;
  const dragOver = targetRef.current ? isEntryTagDropTargetActive(targetRef.current, dragState) : false;

  useEffect(() => subscribeEntryTagDrag(() => setDragState(getEntryTagDragState())), []);

  useEffect(() => {
    const element = targetRef.current;
    if (!element) {
      return;
    }
    return registerEntryTagDropTarget({
      element,
      onDrop: (entryId) => onAssignEntryToTag(entryId, node.path)
    });
  }, [node.path, onAssignEntryToTag]);

  return (
    <div>
      <div
        ref={targetRef}
        className={cn(
          'group/tag flex min-h-7 w-full items-center rounded-md border border-transparent text-xs transition-colors',
          dragOver
            ? 'border-primary bg-primary/10 text-foreground'
            : active
            ? 'border-primary/20 bg-accent font-bold text-primary'
            : 'text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'
        )}
      >
        {hasChildren ? (
          <button
            className="grid size-7 shrink-0 place-items-center rounded-l-md text-inherit"
            title={open ? '收起' : '展开'}
            type="button"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          </button>
        ) : (
          <span className="grid size-7 shrink-0 place-items-center">
            <Hash size={13} aria-hidden="true" />
          </span>
        )}
        <button
          className="flex min-h-7 min-w-0 flex-1 items-center gap-2 rounded-r-md pr-2 text-left text-inherit"
          title={node.path}
          type="button"
          onClick={() => onSelectTag(node.id)}
        >
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span
            className={cn(
              'min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-extrabold',
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground group-hover/tag:bg-white group-hover/tag:text-foreground'
            )}
          >
            {node.count}
          </span>
        </button>
      </div>
      {hasChildren && open ? (
        <div className="ml-3 border-l border-border pl-1">
          {node.children.map((child) => (
            <SidebarTagTreeItem
              activeTag={activeTag}
              key={child.id}
              node={child}
              onAssignEntryToTag={onAssignEntryToTag}
              onSelectTag={onSelectTag}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
