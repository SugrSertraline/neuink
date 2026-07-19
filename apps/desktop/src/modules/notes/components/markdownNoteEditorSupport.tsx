import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import type { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import Placeholder from '@tiptap/extension-placeholder';
import UnderlineExtension from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  ExternalLink,
  FileDown,
  FolderOpen,
  GripVertical,
  Link2,
  Loader2,
  Plus,
  PlusCircle,
  Rows3,
  Save,
  Trash2
} from 'lucide-react';
import { forwardRef, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useToast } from '@/shared/hooks/useToast';
import {
  importNoteAsset,
  openNoteFile,
  revealNoteFile,
  saveNoteMarkdownAs
} from '@/shared/ipc/workspaceApi';
import { parseSourceLinkClipboardPayload } from '@/shared/lib/sourceLinkClipboard';
import type { NoteDocument, SourceLink } from '@/shared/types/domain';

import { CalloutBlock } from '../editor/CalloutBlock';
import { DataTableNode } from '../editor/DataTableNode';
import { MarkdownTextStyle } from '../editor/MarkdownTextStyle';
import { NoteImage } from '../editor/NoteImage';
import {
  dematerializeMarkdownSourceLinks,
  SourceLinkNode,
  findSourceLinkForSegment,
  type SourceLinkOpenTarget,
  getMarkdownWithSourceLinks,
  hydrateSourceLinkNodes,
  insertSourceLinkNode,
  materializeMarkdownSourceLinks,
  pruneUnusedSourceLinks,
  sourceLinkAnchorIdsInEditor
} from '../editor/SourceLinkNode';
import { TableDeletionShortcuts } from '../editor/TableDeletionShortcuts';
import { sanitizePastedNoteHtml } from '../editor/pasteSanitizer';
import { MarkdownInsertMenu } from './MarkdownInsertMenu';
import { MarkdownInlineToolbar } from './MarkdownInlineToolbar';
import { SourceLinksPanel } from './SourceLinksPanel';

const DRAG_HANDLE_SIZE = 24;
const DRAG_HOVER_GUTTER = 44;

type TableContextMenuState = {
  anchorPos: number;
  left: number;
  top: number;
};

type InsertMenuState = {
  from: number;
  left: number;
  shouldDeleteTrigger: boolean;
  top: number;
};

type TableCommand =
  | 'addColumnAfter'
  | 'addColumnBefore'
  | 'addRowAfter'
  | 'addRowBefore'
  | 'deleteColumn'
  | 'deleteRow'
  | 'deleteTable';

type MarkdownNoteEditorProps = {
  entryId: string;
  fallbackTitle: string;
  noteId: string;
  refreshKey?: number;
  onLoadNote: () => Promise<NoteDocument>;
  onSaveNote: (title: string, markdown: string) => Promise<NoteDocument>;
  compact?: boolean;
  sourceLinkToInsert?: SourceLink | null;
  workspaceRoot?: string | null;
  onCreateSourceLinkFromPaste?: (sourceEntryId: string, segmentUid: string) => Promise<SourceLink>;
  onSourceLinkInserted?: (link: SourceLink) => void;
  onOpenSourceLink?: (target: SourceLinkOpenTarget) => void;
};


export const TableContextMenu = forwardRef<
  HTMLDivElement,
  {
    left: number;
    onRun: (command: TableCommand) => void;
    top: number;
  }
>(function TableContextMenu({ left, onRun, top }, ref) {
  const menuWidth = 208;
  const menuMaxHeight = Math.min(320, window.innerHeight - 16);
  const menuMargin = 8;
  const style: CSSProperties = {
    left: Math.max(menuMargin, Math.min(left, window.innerWidth - menuWidth - menuMargin)),
    maxHeight: menuMaxHeight,
    top: Math.max(menuMargin, Math.min(top, window.innerHeight - menuMaxHeight - menuMargin))
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 w-52 overflow-y-auto rounded-md border border-slate-200 bg-popover p-1 text-sm text-popover-foreground shadow-md"
      role="menu"
      style={style}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">表格</div>
      <TableContextMenuButton icon={<Plus size={14} aria-hidden="true" />} onClick={() => onRun('addColumnBefore')}>
        左侧增加列
      </TableContextMenuButton>
      <TableContextMenuButton icon={<Plus size={14} aria-hidden="true" />} onClick={() => onRun('addColumnAfter')}>
        右侧增加列
      </TableContextMenuButton>
      <TableContextMenuButton icon={<Rows3 size={14} aria-hidden="true" />} onClick={() => onRun('addRowBefore')}>
        上方增加行
      </TableContextMenuButton>
      <TableContextMenuButton icon={<Rows3 size={14} aria-hidden="true" />} onClick={() => onRun('addRowAfter')}>
        下方增加行
      </TableContextMenuButton>
      <TableContextMenuSeparator />
      <TableContextMenuButton icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => onRun('deleteColumn')}>
        删除列
      </TableContextMenuButton>
      <TableContextMenuButton icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => onRun('deleteRow')}>
        删除行
      </TableContextMenuButton>
      <TableContextMenuButton
        destructive
        icon={<Trash2 size={14} aria-hidden="true" />}
        onClick={() => onRun('deleteTable')}
      >
        删除表格
      </TableContextMenuButton>
    </div>
  );
});

export function TableContextMenuButton({
  children,
  destructive = false,
  disabled = false,
  icon,
  onClick
}: {
  children: string;
  destructive?: boolean;
  disabled?: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none transition hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-45',
        destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive'
      )}
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function TableContextMenuSeparator() {
  return <div className="-mx-1 my-1 h-px bg-border" role="separator" />;
}

export function findDirectChildBlock(target: EventTarget | null, root: HTMLElement) {
  if (!(target instanceof Node)) {
    return null;
  }

  let current: HTMLElement | null =
    target instanceof HTMLElement ? target : target.parentElement;

  while (current && current.parentElement !== root) {
    current = current.parentElement;
  }

  if (!current || current.parentElement !== root) {
    return null;
  }

  const index = Array.from(root.children).indexOf(current);
  if (index < 0) {
    return null;
  }

  return {
    element: current,
    index
  };
}

export function findBlockByVerticalPosition(root: HTMLElement, clientY: number) {
  const children = Array.from(root.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );

  for (let index = 0; index < children.length; index += 1) {
    const element = children[index];
    const rect = element.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return {
        element,
        index
      };
    }
  }

  return null;
}

export function getBlockVisualRect(element: HTMLElement) {
  const blockRect = element.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(element);
  const contentRect = range.getBoundingClientRect();
  range.detach();

  if (contentRect.width > 1 && contentRect.height > 1) {
    return contentRect;
  }

  return blockRect;
}

export function findTableFromTarget(target: EventTarget | null) {
  if (!(target instanceof Node)) {
    return null;
  }
  const element = target instanceof HTMLElement ? target : target.parentElement;
  if (element?.closest('[data-neuink-datatable="true"]')) {
    return null;
  }
  const table = element?.closest('table');
  return table instanceof HTMLTableElement ? table : null;
}

export function tableAnchorPos(editor: Editor, table: HTMLTableElement, clientX?: number, clientY?: number) {
  const fallbackElement = table.querySelector('th,td') ?? table;
  const fallbackRect = fallbackElement.getBoundingClientRect();
  const coords = {
    left: clientX ?? fallbackRect.left + Math.min(12, fallbackRect.width / 2),
    top: clientY ?? fallbackRect.top + Math.min(12, fallbackRect.height / 2)
  };
  const pos = editor.view.posAtCoords(coords);
  if (pos) {
    return pos.pos;
  }
  try {
    return editor.view.posAtDOM(fallbackElement, 0);
  } catch {
    return null;
  }
}

export function focusTableAt(editor: Editor, anchorPos: number) {
  const resolvedPos = editor.state.doc.resolve(anchorPos);
  const selection = TextSelection.near(resolvedPos);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
}

export function resolveDropTarget(children: HTMLElement[], clientY: number) {
  if (children.length === 0) {
    return null;
  }

  const firstRect = children[0]?.getBoundingClientRect();
  if (firstRect && clientY <= firstRect.top + firstRect.height / 2) {
    return {
      targetIndex: 0,
      top: firstRect.top
    };
  }

  for (let index = 0; index < children.length; index += 1) {
    const rect = children[index]?.getBoundingClientRect();
    if (!rect) {
      continue;
    }

    if (clientY <= rect.bottom) {
      const before = clientY < rect.top + rect.height / 2;
      return {
        targetIndex: before ? index : index + 1,
        top: before ? rect.top : rect.bottom
      };
    }
  }

  const lastRect = children[children.length - 1]?.getBoundingClientRect();
  if (!lastRect) {
    return null;
  }

  return {
    targetIndex: children.length,
    top: lastRect.bottom
  };
}

export function reorderTopLevelBlocks(editor: Editor, sourceIndex: number, targetIndex: number) {
  const { doc } = editor.state;
  const childCount = doc.childCount;
  if (
    sourceIndex < 0 ||
    sourceIndex >= childCount ||
    targetIndex < 0 ||
    targetIndex > childCount
  ) {
    return;
  }

  const adjustedTarget = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
  if (adjustedTarget === sourceIndex) {
    return;
  }

  const nodes = Array.from({ length: childCount }, (_, index) => doc.child(index));
  const [moved] = nodes.splice(sourceIndex, 1);
  nodes.splice(adjustedTarget, 0, moved);

  const fragment = Fragment.fromArray(nodes);
  const tr = editor.state.tr.replaceWith(0, doc.content.size, fragment);

  let selectionPos = 0;
  for (let index = 0; index < adjustedTarget; index += 1) {
    selectionPos += nodes[index]?.nodeSize ?? 0;
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(selectionPos + 1, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

export function sanitizeExportFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120) || '笔记';
}

export function imageAltFromPath(path: string) {
  const fileName = path.split(/[\\/]/).pop() || '图片';
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || '图片';
}

export function revealInsertedSourceLink(scrollElement: HTMLDivElement | null, anchorId: string) {
  window.requestAnimationFrame(() => {
    const root = scrollElement?.querySelector('.tiptap');
    if (!(root instanceof HTMLElement)) {
      return;
    }

    const target = Array.from(root.querySelectorAll('[data-source-link-anchor-id]')).find(
      (element) => element.getAttribute('data-source-link-anchor-id') === anchorId
    );
    if (!(target instanceof HTMLElement)) {
      return;
    }

    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    target.classList.add('source-link-inserted-flash');
    window.setTimeout(() => target.classList.remove('source-link-inserted-flash'), 1800);
  });
}

export function sourceLinkDescription(link: SourceLink) {
  const firstSource = link.sources[0];
  const parts = [
    link.display_text || null,
    firstSource?.page ? `p.${firstSource.page}` : null,
    firstSource?.segment_type ?? null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : '已添加到当前笔记';
}

export function compareSourceLinks(left: SourceLink, right: SourceLink) {
  const leftSource = left.sources[0];
  const rightSource = right.sources[0];
  return (
    (leftSource?.page ?? Number.MAX_SAFE_INTEGER) -
      (rightSource?.page ?? Number.MAX_SAFE_INTEGER) ||
    (left.display_text || left.anchor_id).localeCompare(right.display_text || right.anchor_id)
  );
}

export function findExistingSourceLinkForSameSource(links: SourceLink[], link: SourceLink) {
  const firstSource = link.sources[0];
  if (!firstSource) {
    return null;
  }

  return findSourceLinkForSegment(links, firstSource.entry_id, firstSource.segment_uid);
}
