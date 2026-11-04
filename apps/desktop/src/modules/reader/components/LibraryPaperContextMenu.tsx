import type { ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu';
import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import { LibraryPaperMenuItems, libraryPaperMenuClassName } from './LibraryPaperMenuItems';

export type LibraryPaperActions = {
  onSelect?: (entryId: string) => void;
  deleteDisabled?: boolean;
  reparseDisabled: boolean;
  onOpen: (entryId: string) => void;
  onOpenInSidePane: (entryId: string) => void;
  onReparse: (entry: LibraryEntry) => void;
  onDelete: (entry: LibraryEntry) => void;
  externalEntryIds?: ReadonlySet<string>;
  sourceHiddenByEntry?: Record<string, boolean>;
  onToggleSourceHidden?: (entry: LibraryEntry) => void;
};

export function LibraryPaperContextMenu({ entry, children, ...actions }: LibraryPaperActions & { entry: LibraryEntry; children: ReactNode }) {
  return <ContextMenu onOpenChange={open => { if (open) actions.onSelect?.(entry.id); }}>
    <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
    <ContextMenuContent className={libraryPaperMenuClassName} data-allow-context-menu="true" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
      <LibraryPaperMenuItems entry={entry} mode="context" {...actions} />
    </ContextMenuContent>
  </ContextMenu>;
}
