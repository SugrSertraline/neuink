import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Hash,
  Pencil,
  Plus,
  Save,
  Trash2,
  X
} from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { TagNode } from '../utils/tagTree';

type TagEditorNodeProps = {
  activeTag: string | null;
  busy: boolean;
  childName: string;
  creatingChildForId: string | null;
  editingId: string | null;
  editingName: string;
  node: TagNode;
  onCreateChild: (node: TagNode) => void;
  onDeleteRequest: (node: TagNode) => void;
  onEdit: (node: TagNode) => void;
  onRename: (node: TagNode) => void;
  onSelectTag: (tag: string | null) => void;
  onSetChildName: (name: string) => void;
  onSetEditingName: (name: string) => void;
  onStartCreateChild: (node: TagNode) => void;
  onStopCreateChild: () => void;
  onStopEdit: () => void;
};

export function TagEditorNode({
  activeTag,
  busy,
  childName,
  creatingChildForId,
  editingId,
  editingName,
  node,
  onCreateChild,
  onDeleteRequest,
  onEdit,
  onRename,
  onSelectTag,
  onSetChildName,
  onSetEditingName,
  onStartCreateChild,
  onStopCreateChild,
  onStopEdit
}: TagEditorNodeProps) {
  const [open, setOpen] = useState(true);
  const active = activeTag === node.id;
  const editing = editingId === node.id;
  const creatingChild = creatingChildForId === node.id;
  const hasChildren = node.children.length > 0;

  const submitChild = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onCreateChild(node);
  };

  return (
    <div>
      <div
        className={cn(
          'grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto] items-center gap-1 rounded-md border border-transparent px-1 transition-colors hover:border-border hover:bg-muted',
          active && 'border-primary/20 bg-accent/80 text-primary',
          editing && 'border-primary/45 bg-primary/5 ring-2 ring-primary/15'
        )}
      >
        {hasChildren ? (
          <Button size="icon-sm" title={open ? '收起' : '展开'} type="button" variant="ghost" onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          </Button>
        ) : (
          <span className="grid size-7 place-items-center text-muted-foreground">
            <Hash size={13} aria-hidden="true" />
          </span>
        )}
        {editing ? (
          <Input
            className="border-primary/45 bg-white font-medium"
            disabled={busy}
            style={{ marginLeft: node.depth * 14 }}
            value={editingName}
            onChange={(event) => onSetEditingName(event.target.value)}
          />
        ) : (
          <button
            className="min-w-0 rounded-md px-2 py-1.5 text-left hover:bg-accent"
            style={{ marginLeft: node.depth * 14 }}
            title={node.path}
            type="button"
            onClick={() => onSelectTag(node.id)}
          >
            <span className="block truncate text-sm font-medium">{node.name}</span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <FolderPlus size={12} aria-hidden="true" />
              <span className="min-w-0 truncate">{node.path}</span>
              <span className="shrink-0">{node.count} 个条目</span>
            </span>
          </button>
        )}
        {editing ? (
          <Button disabled={busy || !editingName.trim()} size="icon-sm" title="保存" type="button" variant="outline" onClick={() => onRename(node)}>
            <Save size={13} aria-hidden="true" />
          </Button>
        ) : (
          <Button disabled={busy} size="icon-sm" title="重命名" type="button" variant="outline" onClick={() => onEdit(node)}>
            <Pencil size={13} aria-hidden="true" />
          </Button>
        )}
        <Button
          disabled={busy}
          size="icon-sm"
          title="添加子标签"
          type="button"
          variant={creatingChild ? 'outline' : 'ghost'}
          onClick={() => onStartCreateChild(node)}
        >
          <Plus size={13} aria-hidden="true" />
        </Button>
        <Button disabled={busy} size="icon-sm" title="删除" type="button" variant="ghost" onClick={() => onDeleteRequest(node)}>
          <Trash2 size={13} aria-hidden="true" />
        </Button>
        {editing ? (
          <Button disabled={busy} size="icon-sm" title="取消" type="button" variant="ghost" onClick={onStopEdit}>
            <X size={13} aria-hidden="true" />
          </Button>
        ) : (
          <span className="size-7" />
        )}
      </div>
      {creatingChild ? (
        <form
          className="mt-1 grid min-h-9 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-1 py-1"
          style={{ marginLeft: node.depth * 14 + 28 }}
          onSubmit={submitChild}
        >
          <span className="grid size-7 place-items-center text-primary">
            <FolderPlus size={13} aria-hidden="true" />
          </span>
          <Input
            autoFocus
            className="h-7 border-primary/35 bg-white"
            disabled={busy}
            placeholder={`添加到 ${node.name} 下`}
            value={childName}
            onChange={(event) => onSetChildName(event.target.value)}
          />
          <Button disabled={busy || !childName.trim()} size="icon-sm" title="添加" type="submit" variant="outline">
            <Plus size={13} aria-hidden="true" />
          </Button>
          <Button disabled={busy} size="icon-sm" title="取消" type="button" variant="ghost" onClick={onStopCreateChild}>
            <X size={13} aria-hidden="true" />
          </Button>
        </form>
      ) : null}
      {hasChildren && open ? (
        <div className="ml-4 border-l border-border pl-1">
          {node.children.map((child) => (
            <TagEditorNode
              activeTag={activeTag}
              busy={busy}
              childName={childName}
              creatingChildForId={creatingChildForId}
              editingId={editingId}
              editingName={editingName}
              key={child.id}
              node={child}
              onCreateChild={onCreateChild}
              onDeleteRequest={onDeleteRequest}
              onEdit={onEdit}
              onRename={onRename}
              onSelectTag={onSelectTag}
              onSetChildName={onSetChildName}
              onSetEditingName={onSetEditingName}
              onStartCreateChild={onStartCreateChild}
              onStopCreateChild={onStopCreateChild}
              onStopEdit={onStopEdit}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
