import { Eye, PanelRight, RotateCcw, Trash2 } from 'lucide-react';
import { Fragment, type HTMLAttributes } from 'react';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { EntryReadingState } from '@/shared/types/domain';
import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import { AssetSummary, StatusBadge, TagBadges, formatDate } from './EntryDisplay';
import { LibraryEntryTitle } from './LibraryEntryTitle';
import { formatLastRead, formatReadingDuration, getReadingProgress } from './libraryReading';
import { useEntryLibraryColumnWidths, type EntryLibraryColumnId } from './useEntryLibraryColumnWidths';

export const ENTRY_LIBRARY_COLUMNS: Array<{ id: EntryLibraryColumnId; label: string }> = [
  { id: 'title', label: '标题' },
  { id: 'reading-progress', label: '阅读进度' },
  { id: 'last-read', label: '最近阅读' },
  { id: 'reading-time', label: '阅读时长' },
  { id: 'tags', label: '标签' },
  { id: 'file', label: '文件' },
  { id: 'parser', label: '解析器' },
  { id: 'updated', label: '更新时间' },
  { id: 'actions', label: '操作' }
];

type LibraryPaperTableProps = {
  active: boolean;
  entries: LibraryEntry[];
  status: 'loading' | 'ready' | 'error';
  emptyMessage: string;
  readingStates: Record<string, EntryReadingState>;
  selectedEntryId: string | null;
  draggingEntryId: string | null;
  visibleColumns: ReadonlySet<EntryLibraryColumnId>;
  pinnedEdges: ReadonlySet<'left' | 'right'>;
  reparseDisabled: boolean;
  getRowProps: (entry: LibraryEntry) => HTMLAttributes<HTMLTableRowElement>;
  onOpen: (entryId: string) => void;
  onOpenInSidePane: (entryId: string) => void;
  onReparse: (entry: LibraryEntry) => void;
  onDelete: (entry: LibraryEntry) => void;
};

const headCellClass = 'h-8 overflow-hidden border-b border-border bg-muted px-3 text-left text-[11px] font-medium text-muted-foreground';
const bodyCellClass = 'h-12 overflow-hidden border-b border-border/60 px-3 py-1 text-left align-middle';
const numericColumns = new Set<EntryLibraryColumnId>(['last-read', 'reading-time', 'updated']);

/** Both library layouts keep this table mounted, including its column and scroll state. */
export function LibraryPaperTable({ active, entries, status, emptyMessage, readingStates, selectedEntryId, draggingEntryId, visibleColumns, pinnedEdges, reparseDisabled, getRowProps, onOpen, onOpenInSidePane, onReparse, onDelete }: LibraryPaperTableProps) {
  const shownColumns = ENTRY_LIBRARY_COLUMNS.filter(column => visibleColumns.has(column.id));
  const leftPinnedColumnId = pinnedEdges.has('left') ? shownColumns[0]?.id ?? null : null;
  const lastColumnId = shownColumns[shownColumns.length - 1]?.id ?? null;
  const rightPinnedColumnId = pinnedEdges.has('right') && lastColumnId !== leftPinnedColumnId ? lastColumnId : null;
  const { getColumnWidth, getResizeHandleProps, tableShellRef } = useEntryLibraryColumnWidths({ active, leftPinnedColumnId, rightPinnedColumnId, visibleColumns });
  const tableWidth = shownColumns.reduce((total, column) => total + getColumnWidth(column.id), 0);
  const spacerBefore = shownColumns.length > 1 ? rightPinnedColumnId ?? lastColumnId : null;
  const getPin = (id: EntryLibraryColumnId) => id === leftPinnedColumnId ? 'left' : id === rightPinnedColumnId ? 'right' : undefined;
  const alignment = (id: EntryLibraryColumnId) => numericColumns.has(id) ? 'text-right tabular-nums' : id === 'actions' ? 'text-center' : 'text-left';

  return <div ref={tableShellRef} className="entry-library-table-shell min-h-0 min-w-0 flex-1 [&>[data-slot=table-container]]:isolate [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-auto [&>[data-slot=table-container]]:overscroll-contain">
    <Table aria-label="论文列表" className="table-fixed border-separate border-spacing-0 text-[13px]" data-layout-width={tableWidth}
      style={{ width: `max(100%, ${tableWidth}px)`, minWidth: `${tableWidth}px`, maxWidth: 'none' }}>
      <colgroup>
        {shownColumns.map(column => {
          const width = getColumnWidth(column.id);
          return <Fragment key={column.id}>
            {spacerBefore === column.id ? <col data-responsive-spacer="true" /> : null}
            <col style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }} />
          </Fragment>;
        })}
        {spacerBefore === null ? <col data-responsive-spacer="true" /> : null}
      </colgroup>
      <TableHeader className="sticky top-0 z-20 bg-muted">
        <TableRow>
          {shownColumns.map(column => <Fragment key={column.id}>
            {spacerBefore === column.id ? <TableHead aria-hidden="true" className={cn(headCellClass, 'px-0')} /> : null}
            <TableHead aria-label={column.label} scope="col" className={cn(headCellClass, alignment(column.id), !getPin(column.id) && 'relative')} pin={getPin(column.id)}>
              {column.label}<span {...getResizeHandleProps(column.id, column.label)} />
            </TableHead>
          </Fragment>)}
          {spacerBefore === null ? <TableHead aria-hidden="true" className={cn(headCellClass, 'px-0')} /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {status !== 'ready' || !entries.length ? <TableRow>
          <TableCell colSpan={shownColumns.length + 1} role={status === 'error' ? 'alert' : undefined}
            className={cn('whitespace-normal px-3 py-8 text-center text-xs', status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {status === 'loading' ? '正在打开条目库...' : status === 'error' ? '无法加载标签和论文，请重新打开工作区后重试。' : emptyMessage}
          </TableCell>
        </TableRow> : entries.map(item => <ContextMenu key={item.id}>
          <ContextMenuTrigger asChild>
            <TableRow {...getRowProps(item)} tabIndex={0} data-entry-id={item.id} data-allow-context-menu="true"
              data-state={item.id === selectedEntryId ? 'selected' : undefined}
              className={cn('group cursor-pointer bg-card hover:bg-muted has-aria-expanded:bg-muted data-[state=selected]:bg-accent outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', item.id === draggingEntryId && '[&>[data-slot=table-cell]>*]:opacity-55')}>
              {shownColumns.map(column => <Fragment key={column.id}>
                {spacerBefore === column.id ? <TableCell aria-hidden="true" className={cn(bodyCellClass, 'px-0')} /> : null}
                <TableCell className={cn(bodyCellClass, alignment(column.id))} pin={getPin(column.id)}>
                  {column.id === 'actions' ? <Button aria-label="移到回收站" title="移到回收站" size="icon-xs" variant="ghost"
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    onClick={event => { event.stopPropagation(); onDelete(item); }}><Trash2 size={14} aria-hidden="true" /></Button>
                    : <PaperCell column={column.id} entry={item} state={readingStates[item.id]} />}
                </TableCell>
              </Fragment>)}
              {spacerBefore === null ? <TableCell aria-hidden="true" className={cn(bodyCellClass, 'px-0')} /> : null}
            </TableRow>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44" data-allow-context-menu="true">
            <ContextMenuLabel className="truncate">{item.title}</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onOpen(item.id)}><Eye size={13} aria-hidden="true" />查看详情</ContextMenuItem>
            <ContextMenuItem onSelect={() => onOpenInSidePane(item.id)}><PanelRight size={13} aria-hidden="true" />在右侧打开</ContextMenuItem>
            {item.status === 'Parsed' || item.status === 'Failed' ? <ContextMenuItem disabled={reparseDisabled} onSelect={() => onReparse(item)}><RotateCcw size={13} aria-hidden="true" />重新解析</ContextMenuItem> : null}
            <ContextMenuItem variant="destructive" onSelect={() => onDelete(item)}><Trash2 size={13} aria-hidden="true" />移到回收站</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>)}
      </TableBody>
    </Table>
  </div>;
}

function PaperCell({ column, entry, state }: { column: EntryLibraryColumnId; entry: LibraryEntry; state?: EntryReadingState }) {
  switch (column) {
    case 'title': return <LibraryEntryTitle entry={entry} />;
    case 'reading-progress': return <ReadingProgressCell state={state} />;
    case 'last-read': return <span className="text-xs text-muted-foreground">{formatLastRead(state?.last_read_at)}</span>;
    case 'reading-time': return <span className="text-xs">{formatReadingDuration(state?.total_active_ms ?? 0)}</span>;
    case 'tags': return <TagBadges tags={entry.tags} compact />;
    case 'file': return <AssetSummary entry={entry} compact />;
    case 'parser': return <StatusBadge status={entry.status} />;
    case 'updated': return <span className="text-xs text-muted-foreground">{formatDate(entry.updatedAt)}</span>;
    default: return null;
  }
}

function ReadingProgressCell({ state }: { state?: EntryReadingState }) {
  const progress = getReadingProgress(state);
  if (!state || (state.total_active_ms <= 0 && state.current_page_idx === null)) return <span className="text-xs text-muted-foreground">未开始</span>;
  const pageLabel = state.current_page_idx === null || state.page_count <= 0 ? '' : `第 ${state.current_page_idx + 1}/${state.page_count} 页`;
  return <div className="min-w-0">
    <div className="mb-1 flex items-center justify-between gap-2 text-[10px] tabular-nums">
      <span>{progress >= 100 ? '已读完' : `${progress}%`}</span><span className="truncate text-muted-foreground">{pageLabel}</span>
    </div>
    <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
  </div>;
}
