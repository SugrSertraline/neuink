import { FolderClosed, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { DisclosureIcon } from '@/components/ui/disclosure-icon';
import { cn } from '@/lib/utils';
import type { TagNode } from '../utils/tagTree';

export function TagEditorNode({ node, active, selected, expanded, busy, onToggle, onSelect, onOpen, onCreateChild, onRename, onDelete }: {
  node: TagNode; active: boolean; selected: boolean; expanded: boolean; busy: boolean;
  onToggle: () => void; onSelect: () => void; onOpen: () => void;
  onCreateChild: () => void; onRename: () => void; onDelete: () => void;
}) {
  return <ContextMenu><ContextMenuTrigger asChild><div data-tag-editor-node onContextMenu={onSelect}
    className={cn('flex h-[58px] w-[218px] cursor-default items-center gap-1 rounded-lg border bg-card p-1.5 shadow-sm transition-colors',
    selected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:border-primary/35')}>
    <button aria-label={`选择标签 ${node.path}`} aria-current={active ? 'location' : undefined} aria-pressed={selected}
      title={`${node.path} · ${node.count} 个条目\n双击打开条目库`}
      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={event => { if (event.detail === 0) onOpen(); else onSelect(); }} onDoubleClick={onOpen} type="button">
      <FolderClosed size={15} className={selected ? 'shrink-0 text-primary' : 'shrink-0 text-muted-foreground'} aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{node.name}</span>
        <span className="block text-[10px] tabular-nums text-muted-foreground">{node.children.length ? `${node.children.length} 个子标签 · ` : ''}{node.count} 个条目</span></span>
    </button>
    {node.children.length ? <Button aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'} ${node.name}`} size="icon-xs" variant="ghost" disabled={busy}
      title={expanded ? '收起子标签' : '展开子标签'} onClick={onToggle}><DisclosureIcon open={expanded} /></Button>
      : <span className="grid size-6 shrink-0 place-items-center text-muted-foreground"><Hash size={13} aria-hidden="true" /></span>}
  </div></ContextMenuTrigger>
    <ContextMenuContent viewportAligned className="w-52 max-w-[calc(100vw-1rem)]">
      <ContextMenuLabel className="truncate" title={node.path}>{node.name}</ContextMenuLabel>
      <ContextMenuItem disabled={busy} onSelect={onOpen}>打开条目</ContextMenuItem>
      {node.children.length ? <ContextMenuItem disabled={busy} onSelect={onToggle}>{expanded ? '收起子标签' : '展开子标签'}</ContextMenuItem> : null}
      <ContextMenuSeparator />
      <ContextMenuItem disabled={busy} onSelect={onCreateChild}>添加子标签</ContextMenuItem>
      <ContextMenuItem disabled={busy} onSelect={onRename}>重命名</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={busy} variant="destructive" onSelect={onDelete}>移入回收站</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}
