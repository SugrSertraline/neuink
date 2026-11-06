import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { CSSProperties, HTMLAttributes } from 'react';
import { Button } from '@/components/ui/button';
import { LibraryPaperContextMenu, type LibraryPaperActions } from './LibraryPaperContextMenu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { EntryReadingState } from '@/shared/types/domain';
import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import type { PdfParseAction } from '@/modules/library/components/PdfParseButton';
import { LibraryPaperMenuItems } from './LibraryPaperMenuItems';
import { AssetSummary, StatusBadge, TagBadges, formatDate } from './EntryDisplay';
import { LibraryEntryTitle } from './LibraryEntryTitle';
import { formatLastRead, formatReadingDuration, getReadingProgress } from './libraryReading';
import { useEntryLibraryColumnWidths, type EntryLibraryColumnId } from './useEntryLibraryColumnWidths';
import { Checkbox } from '@/components/ui/checkbox';
import { LibrarySelectionCheckbox } from './LibrarySelectionCheckbox';
import type { LibraryPaperSelection } from './useLibrarySelection';
import { libraryEntrySourceLabel, nextLibraryEntrySort, type LibraryEntrySort } from './libraryEntrySorting';

export const ENTRY_LIBRARY_COLUMNS: Array<{ id: EntryLibraryColumnId; label: string }> = [
  { id: 'title', label: '标题' },
  { id: 'source', label: '来源' },
  { id: 'reading-progress', label: '阅读进度' },
  { id: 'last-read', label: '最近阅读' },
  { id: 'reading-time', label: '阅读时长' },
  { id: 'tags', label: '标签' },
  { id: 'file', label: '文件' },
  { id: 'parser', label: '解析器' },
  { id: 'updated', label: '更新时间' },
  { id: 'actions', label: '操作' }
];

export type LibraryPaperCollectionProps = LibraryPaperActions & {
  selection?: LibraryPaperSelection;
  pdfParseAction?: PdfParseAction;
  active: boolean;
  entries: LibraryEntry[];
  status: 'loading' | 'ready' | 'error';
  emptyMessage: string;
  readingStates: Record<string, EntryReadingState>;
  selectedEntryId: string | null;
  draggingEntryId: string | null;
  getRowProps: (entry: LibraryEntry) => HTMLAttributes<HTMLElement>;
  sourceKindsByEntry?: Record<string, ('zotero' | 'mineru')[]>;
  sourceChangedEntryIds?: ReadonlySet<string>;
  onReviewSourceChanges?: () => void;
};
type LibraryPaperTableProps = LibraryPaperCollectionProps & {
  sort?: LibraryEntrySort;
  onSortChange?: (sort: LibraryEntrySort | null) => void;
  visibleColumns: ReadonlySet<EntryLibraryColumnId>;
  pinnedEdges: ReadonlySet<'left' | 'right'>;
};

const headCellClass = 'h-8 overflow-hidden border-b border-border border-r border-r-border/20 last:border-r-0 bg-muted px-3 text-center text-[11px] font-medium text-muted-foreground';
const bodyCellClass = 'h-12 overflow-hidden border-b border-border/60 border-r border-r-border/20 last:border-r-0 px-3 py-1 text-left align-middle';
const numericColumns = new Set<EntryLibraryColumnId>(['last-read', 'reading-time', 'updated']);

/** Both library layouts keep this table mounted, including its column and scroll state. */
export function LibraryPaperTable({ active, entries, status, emptyMessage, readingStates, selectedEntryId, draggingEntryId, visibleColumns, pinnedEdges, reparseDisabled, getRowProps, onOpen, onRead, onOpenInSidePane, onReparse, onDelete, onToggleSourceHidden, externalEntryIds, sourceHiddenByEntry, sourceKindsByEntry, sourceChangedEntryIds, onReviewSourceChanges, pdfParseAction, deleteDisabled, onSelect, selection, sort, onSortChange }: LibraryPaperTableProps) {
  const actions = { reparseDisabled, deleteDisabled, onOpen, onRead, onOpenInSidePane, onReparse, onDelete, onToggleSourceHidden, externalEntryIds, sourceHiddenByEntry, onSelect };
  const shownColumns = ENTRY_LIBRARY_COLUMNS.filter(column => visibleColumns.has(column.id));
  const leftPinnedColumnId = pinnedEdges.has('left') ? shownColumns[0]?.id ?? null : null;
  const lastColumnId = shownColumns[shownColumns.length - 1]?.id ?? null;
  const rightPinnedColumnId = pinnedEdges.has('right') && lastColumnId !== leftPinnedColumnId ? lastColumnId : null;
  const selectionWidth = selection?.enabled ? 42 : 0;
  const { getColumnWidth, getResizeHandleProps, hasHorizontalOverflow, tableShellRef } = useEntryLibraryColumnWidths({ active, leftPinnedColumnId, rightPinnedColumnId, visibleColumns, reservedWidth: selectionWidth });
  const tableWidth = selectionWidth + Math.round(shownColumns.reduce((total, column) => total + getColumnWidth(column.id), 0));
  const getPin = (id: EntryLibraryColumnId) => !hasHorizontalOverflow ? undefined : id === leftPinnedColumnId ? 'left' : id === rightPinnedColumnId ? 'right' : undefined;
  const alignment = (id: EntryLibraryColumnId) => numericColumns.has(id) ? 'text-right tabular-nums' : id === 'actions' ? 'text-center' : 'text-left';

  return <div ref={tableShellRef}
    style={{
      '--library-scroll-left': `${hasHorizontalOverflow && leftPinnedColumnId ? getColumnWidth(leftPinnedColumnId) + selectionWidth : 0}px`,
      '--library-scroll-right': `${hasHorizontalOverflow && rightPinnedColumnId ? getColumnWidth(rightPinnedColumnId) : 0}px`
    } as CSSProperties}
    onFocusCapture={event => {
      const header = event.target.closest('th');
      // Native focus scrolling does not account for the opaque pinned columns.
      if (header && !header.dataset.pinned) event.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }}
    className="entry-library-table-shell min-h-0 min-w-0 flex-1 [&>[data-slot=table-container]]:isolate [&>[data-slot=table-container]]:h-full [&>[data-slot=table-container]]:overflow-auto [&>[data-slot=table-container]]:overscroll-contain [&>[data-slot=table-container]]:[scroll-padding-left:var(--library-scroll-left)] [&>[data-slot=table-container]]:[scroll-padding-right:var(--library-scroll-right)]">
    <Table aria-label="论文列表" className="table-fixed border-separate border-spacing-0 text-[13px]" data-layout-width={tableWidth}
      style={{ width: `max(100%, ${tableWidth}px)`, minWidth: `${tableWidth}px`, maxWidth: 'none' }}>
      <colgroup>
        {selection?.enabled && <col style={{ width: selectionWidth }} />}
        {shownColumns.map(column => {
          const width = getColumnWidth(column.id);
          return <col key={column.id} style={{ width: `${width}px`, minWidth: `${width}px`, maxWidth: `${width}px` }} />;
        })}
      </colgroup>
      <TableHeader className="sticky top-0 z-20 bg-muted">
        <TableRow>
          {selection?.enabled && <TableHead className="h-8 border-b border-border border-r border-r-border/20 last:border-r-0 bg-muted px-3 text-center [&:has([role=checkbox])]:pr-3" pin={hasHorizontalOverflow && pinnedEdges.has('left') ? 'left' : undefined}><Checkbox aria-label="全选当前结果" checked={selection.all || selection.some && 'indeterminate'} disabled={status !== 'ready' || !entries.length} onCheckedChange={selection.toggleAll} /></TableHead>}
          {shownColumns.map(column => {
            const sortable = column.id !== 'actions' && Boolean(onSortChange);
            const direction = sortable && sort?.by === column.id ? sort.direction : undefined;
            const nextSort = column.id === 'actions' ? null : nextLibraryEntrySort(column.id, sort);
            const nextLabel = nextSort ? `按${column.label}${nextSort.direction === 'asc' ? '升序' : '降序'}排列` : '恢复默认排序';
            const SortIcon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown;
            return <TableHead key={column.id} aria-label={column.label} scope="col"
              aria-sort={sortable ? direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none' : undefined}
              className={cn(headCellClass, sortable && 'px-1', !getPin(column.id) && 'relative')} pin={getPin(column.id)} style={getPin(column.id) === 'left' ? { left: selectionWidth } : undefined}>
              {sortable ? <Button type="button" size="xs" variant="ghost" disabled={status !== 'ready'}
                className={cn('relative h-7 w-full px-5 text-[11px] focus-visible:ring-inset', direction && 'text-foreground')}
                aria-label={nextLabel}
                title={nextLabel}
                onClick={() => onSortChange?.(nextSort)}>
                <span className="truncate">{column.label}</span>
                <SortIcon aria-hidden="true" className={cn('absolute right-1 size-3', !direction && 'text-muted-foreground/60')} />
              </Button> : column.label}
              <span {...getResizeHandleProps(column.id, column.label)} />
            </TableHead>;
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {status !== 'ready' || !entries.length ? <TableRow>
          <TableCell colSpan={shownColumns.length + (selection?.enabled ? 1 : 0)} role={status === 'error' ? 'alert' : undefined}
            className={cn('whitespace-normal px-3 py-8 text-center text-xs', status === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            {status === 'loading' ? '正在打开条目库...' : status === 'error' ? '无法加载标签和论文，请重新打开工作区后重试。' : emptyMessage}
          </TableCell>
        </TableRow> : entries.map(item => <LibraryPaperContextMenu key={item.id} entry={item} {...actions}>
            <TableRow {...getRowProps(item)} tabIndex={0} data-entry-id={item.id} data-allow-context-menu="true"
              data-state={(selection?.enabled ? selection.ids.has(item.id) : item.id === selectedEntryId) ? 'selected' : undefined}
              aria-selected={selection?.enabled ? selection.ids.has(item.id) : item.id === selectedEntryId}
              className={cn('group cursor-pointer bg-card hover:bg-muted data-[state=selected]:bg-accent data-[state=selected]:hover:bg-accent data-[state=selected]:has-aria-expanded:bg-accent outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring', item.id === draggingEntryId && '[&>[data-slot=table-cell]>*]:opacity-55')}>
              {selection?.enabled && <TableCell className={cn(bodyCellClass, 'px-3')} pin={hasHorizontalOverflow && pinnedEdges.has('left') ? 'left' : undefined}><LibrarySelectionCheckbox entryId={item.id} title={item.title} selection={selection} /></TableCell>}
              {shownColumns.map(column =>
                <TableCell key={column.id} className={cn(bodyCellClass, alignment(column.id), column.id === 'actions' && 'px-4 py-2')} pin={getPin(column.id)} style={getPin(column.id) === 'left' ? { left: selectionWidth } : undefined}>
                  {column.id === 'actions' ? <div role="group" aria-label={`条目操作：${item.title}`} className="flex flex-wrap items-center justify-center gap-1.5"
                    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
                    <LibraryPaperMenuItems entry={item} mode="inline" pdfParseAction={pdfParseAction} {...actions} />
                    </div>
                    : column.id === 'source' ? <div className="flex min-w-0 items-center gap-1"><div className="min-w-0 text-xs"><p className="truncate" title={libraryEntrySourceLabel(sourceKindsByEntry?.[item.id] ?? item.sourceInfo?.kinds)}>{libraryEntrySourceLabel(sourceKindsByEntry?.[item.id] ?? item.sourceInfo?.kinds)}</p>{item.sourceInfo?.local_copy_ids?.length ? <p className="truncate text-[11px] text-muted-foreground">本地已存在</p> : item.sourceInfo?.copied_from && <p className="truncate text-[11px] text-muted-foreground" title={`独立副本，复制自 ${item.sourceInfo.copied_from.source_title}`}>独立副本</p>}</div>{sourceChangedEntryIds?.has(item.id) && onReviewSourceChanges ? <Button size="xs" variant="ghost" className="shrink-0 px-1 text-warning" onClick={event => { event.stopPropagation(); onReviewSourceChanges(); }}>有更新</Button> : null}</div>
                    : <PaperCell column={column.id} entry={item} state={readingStates[item.id]} />}
                </TableCell>
              )}
            </TableRow>
        </LibraryPaperContextMenu>)}
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
    case 'file': return !entry.pdfFileName && entry.sourceInfo?.kinds.length && entry.sourceInfo.source_pdf_hash
      ? <span className="text-xs text-muted-foreground">{entry.sourceInfo.local_copy_ids?.length ? 'PDF 在本地条目' : '来源 PDF'}</span> : <AssetSummary entry={entry} compact />;
    case 'parser': return !entry.pdfFileName && entry.sourceInfo?.kinds.length && entry.sourceInfo.source_pdf_hash
      ? <span className="text-xs text-muted-foreground">{entry.sourceInfo.local_copy_ids?.length ? '在本地条目解析' : '导入本地后解析'}</span> : <StatusBadge status={entry.status} />;
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
