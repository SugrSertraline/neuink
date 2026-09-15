import { ChevronDown, ChevronRight, FileText, Folder, FolderTree, Hash } from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getEntryTagDragState, isEntryTagDropTargetActive, registerEntryTagDropTarget, subscribeEntryTagDrag } from '@/shared/lib/entryDragData';
import type { TagDensity, TagNavigationMode } from '@/shared/lib/tagPreferences';
import type { TagNode } from '../utils/tagTree';

type SidebarTagRowProps = {
  active: boolean;
  node: TagNode;
  presentation: TagNavigationMode;
  density: TagDensity;
  showCounts: boolean;
  open?: boolean;
  onToggle?: () => void;
  onAssignEntryToTag?: (entryId: string, tagPath: string) => Promise<unknown> | unknown;
  onOpenTagDetails: (tagId: string) => void;
  onBrowseTag?: (tagId: string) => void;
};

export function SidebarTagRow({ active, node, presentation, density, showCounts, open, onToggle, onAssignEntryToTag, onOpenTagDetails, onBrowseTag }: SidebarTagRowProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const drag = useSyncExternalStore(subscribeEntryTagDrag, getEntryTagDragState, getEntryTagDragState);
  const dragOver = targetRef.current ? isEntryTagDropTargetActive(targetRef.current, drag) : false;
  const hasChildren = node.children.length > 0;
  const parentPath = node.path.slice(0, -(node.name.length + 1));
  const rowHeight = density === 'comfortable' ? 'min-h-10' : 'min-h-8';

  useEffect(() => {
    const element = targetRef.current;
    if (!element || !onAssignEntryToTag) return;
    return registerEntryTagDropTarget({ element, onDrop: entryId => onAssignEntryToTag(entryId, node.path) });
  }, [node.path, onAssignEntryToTag]);

  return (
    <div ref={targetRef} data-tag-id={node.id} className={cn(
      'group/tag flex w-full min-w-0 items-center rounded-md border border-transparent text-xs transition-colors', rowHeight,
      dragOver ? 'border-primary bg-primary/10 text-foreground' : active ? 'border-primary/20 bg-accent font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    )}>
      {presentation === 'tree' && hasChildren ? (
        <Button aria-expanded={open} aria-label={`${open ? '收起' : '展开'} ${node.name}`} className="shrink-0 rounded-r-none text-inherit hover:text-inherit aria-expanded:text-inherit" size="icon-sm" title={open ? '收起' : '展开'} type="button" variant="plain" onClick={onToggle}>
          {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        </Button>
      ) : <span className="grid size-7 shrink-0 place-items-center">{hasChildren ? <Folder size={13} aria-hidden="true" /> : <Hash size={13} aria-hidden="true" />}</span>}
      <button aria-current={active ? 'page' : undefined} aria-label={`打开标签 ${node.path}`} className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-r-md bg-transparent py-1 pr-2 text-left text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50', rowHeight)} title={`进入标签：${node.path}${hasChildren && presentation !== 'paths' ? ' · 双击展开下级标签' : ''}`} type="button"
        onClick={event => { if (event.detail <= 1) onOpenTagDetails(node.id); }}
        onDoubleClick={() => {
          if (!hasChildren) return;
          if (presentation === 'directory') onBrowseTag?.(node.id);
          if (presentation === 'tree' && !open) onToggle?.();
        }}>
        <span className="min-w-0 flex-1">
          <span className={cn('block', density === 'comfortable' ? 'line-clamp-2 break-words' : 'truncate')}>{node.name}</span>
          {presentation === 'paths' ? <span className="block truncate text-[11px] font-normal text-muted-foreground">{node.parentId ? parentPath : '顶层标签'}</span> : null}
        </span>
        {showCounts ? (
          <span
            className="flex shrink-0 items-center gap-1 text-[10px] font-normal tabular-nums text-muted-foreground"
            title={`${node.children.length} 个直属子标签；${node.count} 篇论文（包含子标签，同一论文只计一次）`}
          >
            {hasChildren ? (
              <span
                aria-label={`${node.children.length} 个直属子标签`}
                className="inline-flex items-center gap-0.5"
                data-count-kind="children"
                title={`${node.children.length} 个直属子标签`}
              >
                <FolderTree className="size-3 opacity-70" aria-hidden="true" />
                <span>{node.children.length}</span>
              </span>
            ) : null}
            <span
              aria-label={`${node.count} 篇论文，包含子标签且同一论文只计一次`}
              className="inline-flex items-center gap-0.5"
              data-count-kind="papers"
              title={`${node.count} 篇论文（包含子标签，同一论文只计一次）`}
            >
              <FileText className="size-3 opacity-70" aria-hidden="true" />
              <span>{node.count}</span>
            </span>
          </span>
        ) : null}
      </button>
      {presentation === 'directory' && hasChildren && onBrowseTag ? (
        <Button aria-label={`浏览子标签 ${node.path}`} className="shrink-0 text-inherit" size="icon-sm" title={`浏览 ${node.path} 的子标签`} type="button" variant="plain" onClick={() => onBrowseTag(node.id)}>
          <ChevronRight size={13} aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
