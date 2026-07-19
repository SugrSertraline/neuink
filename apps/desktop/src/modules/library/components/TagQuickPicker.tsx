import { Check, ChevronDown, ChevronRight, Hash } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { TagMeta } from '@/shared/types/domain';

import { buildTagTree, type TagNode } from '../utils/tagTree';
import { isSiblingTagBlocked } from '../utils/tagSelection';

type TagQuickPickerProps = {
  allowMultiple?: boolean;
  disabled?: boolean;
  selectedPaths: string[];
  tags: TagMeta[];
  onTogglePath: (path: string) => void;
};

export function TagQuickPicker({
  allowMultiple = false,
  disabled,
  selectedPaths,
  tags,
  onTogglePath
}: TagQuickPickerProps) {
  const tagTree = useMemo(() => buildTagTree(tags), [tags]);
  const selected = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  if (tagTree.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        输入嵌套路径，例如“研究/计算机视觉/检测”，创建条目时会自动创建标签。
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-52 rounded-lg border bg-muted/20">
      <div className="grid gap-1 p-2">
        {tagTree.map((node) => (
          <QuickTagNode
            allowMultiple={allowMultiple}
            disabled={disabled}
            key={node.id}
            node={node}
            selected={selected}
            onTogglePath={onTogglePath}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function QuickTagNode({
  allowMultiple,
  disabled,
  node,
  selected,
  onTogglePath
}: {
  allowMultiple: boolean;
  disabled?: boolean;
  node: TagNode;
  selected: Set<string>;
  onTogglePath: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const checked = selected.has(node.path);
  const blocked = !allowMultiple && !checked && isSiblingTagBlocked(node.path, [...selected]);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div className="grid min-h-8 grid-cols-[auto_minmax(0,1fr)] items-center gap-1">
        {hasChildren ? (
          <button
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            disabled={disabled}
            title={open ? '收起' : '展开'}
            type="button"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          </button>
        ) : (
          <span className="grid size-7 place-items-center text-muted-foreground">
            <Hash size={12} aria-hidden="true" />
          </span>
        )}
        <button
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
            checked
              ? 'bg-primary text-primary-foreground'
              : blocked
                ? 'cursor-not-allowed text-muted-foreground/45'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
          disabled={disabled || blocked}
          style={{ marginLeft: node.depth * 12 }}
          title={node.path}
          type="button"
          onClick={() => onTogglePath(node.path)}
        >
          <span className="grid size-4 shrink-0 place-items-center">
            {checked ? <Check size={13} aria-hidden="true" /> : null}
          </span>
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {hasChildren ? <span className="text-[10px] opacity-75">{node.children.length}</span> : null}
        </button>
      </div>
      {hasChildren && open ? (
        <div className="ml-7 border-l border-border pl-1">
          {node.children.map((child) => (
            <QuickTagNode
              allowMultiple={allowMultiple}
              disabled={disabled}
              key={child.id}
              node={child}
              selected={selected}
              onTogglePath={onTogglePath}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
