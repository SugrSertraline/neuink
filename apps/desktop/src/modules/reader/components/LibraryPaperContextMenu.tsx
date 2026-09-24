import { Eye, PanelRight, RotateCcw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { LibraryEntry } from '../../library/components/LibrarySidebar';

export type LibraryPaperActions = {
  reparseDisabled: boolean;
  onOpen: (entryId: string) => void;
  onOpenInSidePane: (entryId: string) => void;
  onReparse: (entry: LibraryEntry) => void;
  onDelete: (entry: LibraryEntry) => void;
};

export function LibraryPaperContextMenu({ entry, children, reparseDisabled, onOpen, onOpenInSidePane, onReparse, onDelete }: LibraryPaperActions & { entry: LibraryEntry; children: ReactNode }) {
  return <ContextMenu>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent className="w-44" data-allow-context-menu="true">
      <ContextMenuLabel className="truncate">{entry.title}</ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onOpen(entry.id)}><Eye size={13} aria-hidden="true" />查看详情</ContextMenuItem>
      <ContextMenuItem onSelect={() => onOpenInSidePane(entry.id)}><PanelRight size={13} aria-hidden="true" />在右侧打开</ContextMenuItem>
      {entry.status === 'Parsed' || entry.status === 'Failed' ? <ContextMenuItem disabled={reparseDisabled} onSelect={() => onReparse(entry)}><RotateCcw size={13} aria-hidden="true" />重新解析</ContextMenuItem> : null}
      <ContextMenuItem variant="destructive" onSelect={() => onDelete(entry)}><Trash2 size={13} aria-hidden="true" />移到回收站</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}
