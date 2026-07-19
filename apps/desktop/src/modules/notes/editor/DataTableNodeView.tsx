import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import {
  EyeOff,
  GripHorizontal,
  GripVertical,
  Plus,
  Search,
  Trash2
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

import {
  cloneDataTable,
  createEmptyDataTableCell,
  makeDataTableId,
  normalizeDataTable,
  type DataTableCell,
  type DataTableCellValue,
  type DataTableColumn,
  type DataTableColumnType,
  type DataTableDocument,
  type DataTableRow,
  type DataTableViewConfig
} from './DataTableNode';

type CellPoint = {
  col: number;
  row: number;
};

type CellRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

type VisibleColumn = {
  column: DataTableColumn;
  sourceIndex: number;
};

type DisplayRow = {
  row: DataTableRow;
  sourceIndex: number;
};

type ResizePreview = {
  columnId: string;
  width: number;
};

type TableDragState = {
  from: number;
  kind: 'column' | 'row';
  over: number;
};

type DataTableMenuState =
  | {
      clientX: number;
      clientY: number;
      kind: 'column';
      sourceIndex: number;
      visibleColIndex: number;
    }
  | {
      clientX: number;
      clientY: number;
      displayRowIndex: number;
      kind: 'row';
      rowIndex: number;
    };

const COLUMN_TYPES: Array<{ label: string; value: DataTableColumnType }> = [
  { label: '文本', value: 'text' },
  { label: '数字', value: 'number' },
  { label: '勾选', value: 'checkbox' },
  { label: '日期', value: 'date' },
  { label: '选项', value: 'select' },
  { label: '状态', value: 'status' },
  { label: '链接', value: 'url' }
];


import {
  ColumnHeaderMenu,
  EdgeAddButton,
  RowHeaderMenu,
  cellDisplayText,
  clampColumnWidth,
  clampNumber,
  coerceCellValue,
  columnParticipatesInMerge,
  countVisibleCells,
  eachVisibleCell,
  filterLabel,
  getActiveView,
  getDisplayedRows,
  hasMergedCells,
  interactiveTarget,
  isMergeableRect,
  moveArrayItem,
  pointInRect,
  rectFromPoints,
  renderCellEditor,
  selectedVisibleColumns,
  visibleColspan,
  widthForColumn
} from './dataTableNodeViewSupport';

export function DataTableNodeView({ node, selected, updateAttributes }: NodeViewProps) {
  const table = useMemo(
    () => normalizeDataTable((node.attrs as { data?: DataTableDocument }).data),
    [node.attrs]
  );
  const activeView = useMemo(() => getActiveView(table), [table]);
  const visibleColumns = useMemo(
    () =>
      table.columns
        .map((column, sourceIndex) => ({ column, sourceIndex }))
        .filter(({ column }) => !column.hidden && !activeView.hiddenColumnIds.includes(column.id)),
    [activeView.hiddenColumnIds, table.columns]
  );
  const hiddenColumns = useMemo(
    () =>
      table.columns.filter(
        (column) => !column.hidden && activeView.hiddenColumnIds.includes(column.id)
      ),
    [activeView.hiddenColumnIds, table.columns]
  );
  const displayedRows = useMemo(
    () => getDisplayedRows(table, activeView, visibleColumns),
    [activeView, table, visibleColumns]
  );
  const [anchor, setAnchor] = useState<CellPoint>({ col: 0, row: 0 });
  const [focus, setFocus] = useState<CellPoint>({ col: 0, row: 0 });
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);
  const [menuState, setMenuState] = useState<DataTableMenuState | null>(null);
  const selection = rectFromPoints(anchor, focus);
  const selectedCellCount = countVisibleCells(table, selection, visibleColumns);
  const activeColumnRef = visibleColumns[anchor.col] ?? visibleColumns[0] ?? null;
  const activeCell = activeColumnRef ? table.rows[anchor.row]?.cells[activeColumnRef.column.id] : null;
  const tableHasMergedCells = hasMergedCells(table);
  const canSplit = Boolean(
    activeCell && !activeCell.hidden && ((activeCell.rowspan ?? 1) > 1 || (activeCell.colspan ?? 1) > 1)
  );
  const canMerge = selectedCellCount > 1 && isMergeableRect(table, selection, visibleColumns);
  const [dragSelect, setDragSelect] = useState(false);
  const [tableDrag, setTableDrag] = useState<TableDragState | null>(null);

  const commit = (next: DataTableDocument) => {
    updateAttributes({ data: normalizeDataTable(next) });
  };

  const updateActiveView = (mutator: (view: DataTableViewConfig) => void) => {
    const next = cloneDataTable(table);
    const view = getActiveView(next);
    mutator(view);
    next.activeViewId = view.id;
    commit(next);
  };

  const selectCell = (point: CellPoint, extend: boolean) => {
    if (extend) {
      setFocus(point);
      return;
    }
    setAnchor(point);
    setFocus(point);
  };

  const selectRow = (row: number, extend: boolean) => {
    const point = { row, col: Math.max(0, visibleColumns.length - 1) };
    if (extend) {
      setFocus(point);
      return;
    }
    setAnchor({ row, col: 0 });
    setFocus(point);
  };

  const selectColumn = (col: number, extend: boolean) => {
    const point = { row: Math.max(0, table.rows.length - 1), col };
    if (extend) {
      setFocus(point);
      return;
    }
    setAnchor({ row: 0, col });
    setFocus(point);
  };

  const moveSelection = (rowDelta: number, colDelta: number) => {
    if (visibleColumns.length === 0 || displayedRows.length === 0) {
      return;
    }
    const currentDisplayIndex = Math.max(
      0,
      displayedRows.findIndex((item) => item.sourceIndex === anchor.row)
    );
    const nextDisplayIndex = clampNumber(currentDisplayIndex + rowDelta, 0, displayedRows.length - 1);
    const nextPoint = {
      row: displayedRows[nextDisplayIndex]?.sourceIndex ?? anchor.row,
      col: clampNumber(anchor.col + colDelta, 0, visibleColumns.length - 1)
    };
    setAnchor(nextPoint);
    setFocus(nextPoint);
  };

  const updateTableTitle = (title: string) => {
    const next = cloneDataTable(table);
    next.title = title;
    commit(next);
  };

  const updateViewSearch = (search: string) => {
    updateActiveView((view) => {
      view.search = search.trim() ? search : undefined;
    });
  };

  const updateCellValue = (row: number, visibleCol: number, value: DataTableCellValue) => {
    const next = cloneDataTable(table);
    const column = visibleColumns[visibleCol]?.column;
    const cell = column ? next.rows[row]?.cells[column.id] : null;
    if (!cell || cell.hidden) {
      return;
    }
    cell.value = value;
    commit(next);
  };

  const updateColumnName = (columnId: string, name: string) => {
    const next = cloneDataTable(table);
    const column = next.columns.find((candidate) => candidate.id === columnId);
    if (!column) {
      return;
    }
    column.name = name;
    commit(next);
  };

  const updateColumnType = (columnId: string, type: DataTableColumnType) => {
    const next = cloneDataTable(table);
    const column = next.columns.find((candidate) => candidate.id === columnId);
    if (!column) {
      return;
    }
    column.type = type;
    next.rows.forEach((row) => {
      const cell = row.cells[columnId];
      if (cell) {
        cell.value = coerceCellValue(cell.value, type);
      }
    });
    commit(next);
  };

  const hideColumn = (columnId: string) => {
    if (visibleColumns.length <= 1) {
      return;
    }
    updateActiveView((view) => {
      view.hiddenColumnIds = Array.from(new Set([...view.hiddenColumnIds, columnId]));
    });
    const nextCol = Math.min(anchor.col, Math.max(0, visibleColumns.length - 2));
    setAnchor({ row: anchor.row, col: nextCol });
    setFocus({ row: anchor.row, col: nextCol });
  };

  const showColumn = (columnId: string) => {
    updateActiveView((view) => {
      view.hiddenColumnIds = view.hiddenColumnIds.filter((hiddenColumnId) => hiddenColumnId !== columnId);
    });
  };

  const cycleColumnSort = (columnId: string) => {
    updateActiveView((view) => {
      const existing = view.sorts.find((sort) => sort.columnId === columnId);
      if (!existing) {
        view.sorts = [{ id: makeDataTableId('sort'), columnId, direction: 'asc' }];
        return;
      }
      if (existing.direction === 'asc') {
        view.sorts = [{ ...existing, direction: 'desc' }];
        return;
      }
      view.sorts = view.sorts.filter((sort) => sort.columnId !== columnId);
    });
  };

  const cycleColumnFilter = (columnId: string) => {
    updateActiveView((view) => {
      const existing = view.filters.find((filterItem) => filterItem.columnId === columnId);
      if (!existing) {
        view.filters = [
          ...view.filters,
          { id: makeDataTableId('filter'), columnId, operator: 'is_not_empty' }
        ];
        return;
      }
      if (existing.operator === 'is_not_empty') {
        view.filters = view.filters.map((filterItem) =>
          filterItem.id === existing.id ? { ...filterItem, operator: 'is_empty' } : filterItem
        );
        return;
      }
      view.filters = view.filters.filter((filterItem) => filterItem.id !== existing.id);
    });
  };

  const setColumnSort = (columnId: string, direction: DataTableViewConfig['sorts'][number]['direction'] | null) => {
    updateActiveView((view) => {
      view.sorts = direction ? [{ id: makeDataTableId('sort'), columnId, direction }] : [];
    });
  };

  const setColumnFilter = (
    columnId: string,
    operator: DataTableViewConfig['filters'][number]['operator'] | null
  ) => {
    updateActiveView((view) => {
      view.filters = operator
        ? [
            ...view.filters.filter((filterItem) => filterItem.columnId !== columnId),
            { id: makeDataTableId('filter'), columnId, operator }
          ]
        : view.filters.filter((filterItem) => filterItem.columnId !== columnId);
    });
  };

  const startColumnResize = (event: React.PointerEvent, columnId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthForColumn(table.columns.find((column) => column.id === columnId), resizePreview);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setResizePreview({
        columnId,
        width: clampColumnWidth(startWidth + moveEvent.clientX - startX)
      });
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      const nextWidth = clampColumnWidth(startWidth + upEvent.clientX - startX);
      setResizePreview(null);
      const next = cloneDataTable(table);
      const column = next.columns.find((candidate) => candidate.id === columnId);
      if (column) {
        column.width = nextWidth;
        commit(next);
      }
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp, { once: true });
  };

  const clearSelection = () => {
    const next = cloneDataTable(table);
    eachVisibleCell(next, selection, visibleColumns, (cell) => {
      cell.value = '';
    });
    commit(next);
  };

  const addRowAt = (insertAt: number) => {
    const next = cloneDataTable(table);
    const normalizedInsertAt = clampNumber(insertAt, 0, next.rows.length);
    next.rows.splice(normalizedInsertAt, 0, {
      id: makeDataTableId('row', normalizedInsertAt),
      cells: Object.fromEntries(
        next.columns.map((column, colIndex) => [
          column.id,
          createEmptyDataTableCell(column.type, `cell-${normalizedInsertAt}`, colIndex)
        ])
      )
    });
    commit(next);
    setAnchor({ row: normalizedInsertAt, col: Math.min(anchor.col, visibleColumns.length - 1) });
    setFocus({ row: normalizedInsertAt, col: Math.min(anchor.col, visibleColumns.length - 1) });
  };

  const addRowAfter = () => {
    addRowAt(selection.bottom + 1);
  };

  const addColumnAt = (insertAt: number) => {
    const next = cloneDataTable(table);
    const normalizedInsertAt = clampNumber(insertAt, 0, next.columns.length);
    const columnId = makeDataTableId('col', normalizedInsertAt);
    next.columns.splice(normalizedInsertAt, 0, {
      id: columnId,
      name: `Column ${normalizedInsertAt + 1}`,
      type: 'text',
      width: 160
    });
    next.rows.forEach((row, rowIndex) => {
      row.cells[columnId] = createEmptyDataTableCell('text', `cell-${rowIndex}`, normalizedInsertAt);
    });
    commit(next);
    const visibleInsertCol = visibleColumns.filter((item) => item.sourceIndex < normalizedInsertAt).length;
    setAnchor({ row: Math.min(anchor.row, next.rows.length - 1), col: visibleInsertCol });
    setFocus({ row: Math.min(anchor.row, next.rows.length - 1), col: visibleInsertCol });
  };

  const addColumnAfter = () => {
    const selectedColumn = visibleColumns[Math.min(selection.right, visibleColumns.length - 1)];
    addColumnAt((selectedColumn?.sourceIndex ?? table.columns.length - 1) + 1);
  };

  const deleteSelectedRows = () => {
    if (table.rows.length <= 1) {
      clearSelection();
      return;
    }
    const next = cloneDataTable(table);
    next.rows.splice(selection.top, selection.bottom - selection.top + 1);
    commit(next);
    const row = Math.min(selection.top, next.rows.length - 1);
    const col = Math.min(anchor.col, visibleColumns.length - 1);
    setAnchor({ row, col });
    setFocus({ row, col });
  };

  const deleteSelectedColumns = () => {
    const selectedColumns = selectedVisibleColumns(selection, visibleColumns);
    if (table.columns.length <= selectedColumns.length) {
      clearSelection();
      return;
    }
    const removedIds = new Set(selectedColumns.map(({ column }) => column.id));
    const next = cloneDataTable(table);
    next.columns = next.columns.filter((column) => !removedIds.has(column.id));
    next.rows.forEach((row) => {
      for (const columnId of removedIds) {
        delete row.cells[columnId];
      }
    });
    next.views.forEach((view) => {
      view.hiddenColumnIds = view.hiddenColumnIds.filter((columnId) => !removedIds.has(columnId));
      view.filters = view.filters.filter((filterItem) => !removedIds.has(filterItem.columnId));
      view.sorts = view.sorts.filter((sort) => !removedIds.has(sort.columnId));
    });
    commit(next);
    const row = Math.min(anchor.row, next.rows.length - 1);
    const col = Math.min(selection.left, Math.max(0, visibleColumns.length - selectedColumns.length - 1));
    setAnchor({ row, col });
    setFocus({ row, col });
  };

  const mergeSelection = () => {
    if (!canMerge) {
      return;
    }
    const selectedColumns = selectedVisibleColumns(selection, visibleColumns);
    const next = cloneDataTable(table);
    const anchorColumn = selectedColumns[0]?.column;
    const anchorCell = anchorColumn ? next.rows[selection.top]?.cells[anchorColumn.id] : null;
    if (!anchorCell) {
      return;
    }

    const mergedText: string[] = [];
    eachVisibleCell(next, selection, visibleColumns, (cell) => {
      const text = cellDisplayText(cell).trim();
      if (text) {
        mergedText.push(text);
      }
      cell.value = '';
      cell.hidden = true;
      cell.rowspan = 1;
      cell.colspan = 1;
    });
    anchorCell.hidden = false;
    anchorCell.rowspan = selection.bottom - selection.top + 1;
    anchorCell.colspan =
      selectedColumns[selectedColumns.length - 1].sourceIndex - selectedColumns[0].sourceIndex + 1;
    anchorCell.value = mergedText.join('\n');
    commit(next);
    setAnchor({ row: selection.top, col: selection.left });
    setFocus({ row: selection.top, col: selection.left });
  };

  const splitActiveCell = () => {
    const next = cloneDataTable(table);
    const columnRef = visibleColumns[anchor.col];
    const cell = columnRef ? next.rows[anchor.row]?.cells[columnRef.column.id] : null;
    if (!cell || cell.hidden) {
      return;
    }
    const rowspan = cell.rowspan ?? 1;
    const colspan = cell.colspan ?? 1;
    cell.rowspan = 1;
    cell.colspan = 1;
    for (let row = anchor.row; row < anchor.row + rowspan; row += 1) {
      for (let col = columnRef.sourceIndex; col < columnRef.sourceIndex + colspan; col += 1) {
        const coveredColumn = next.columns[col];
        const covered = coveredColumn ? next.rows[row]?.cells[coveredColumn.id] : null;
        if (covered && covered !== cell) {
          covered.hidden = false;
          covered.rowspan = 1;
          covered.colspan = 1;
        }
      }
    }
    commit(next);
  };

  const finishTableDrag = () => {
    if (!tableDrag || tableDrag.from === tableDrag.over || tableHasMergedCells) {
      setTableDrag(null);
      return;
    }

    const next = cloneDataTable(table);
    if (tableDrag.kind === 'row') {
      const fromRow = displayedRows[tableDrag.from]?.sourceIndex;
      const overRow = displayedRows[tableDrag.over]?.sourceIndex;
      if (fromRow !== undefined && overRow !== undefined) {
        moveArrayItem(next.rows, fromRow, overRow);
        const nextRow = clampNumber(overRow, 0, next.rows.length - 1);
        setAnchor({ row: nextRow, col: anchor.col });
        setFocus({ row: nextRow, col: anchor.col });
      }
    } else {
      const fromColumn = visibleColumns[tableDrag.from]?.sourceIndex;
      const overColumn = visibleColumns[tableDrag.over]?.sourceIndex;
      if (fromColumn !== undefined && overColumn !== undefined) {
        moveArrayItem(next.columns, fromColumn, overColumn);
        const nextCol = clampNumber(tableDrag.over, 0, visibleColumns.length - 1);
        setAnchor({ row: anchor.row, col: nextCol });
        setFocus({ row: anchor.row, col: nextCol });
      }
    }

    commit(next);
    setTableDrag(null);
  };

  const edgeAddColumnBefore = () => {
    const selectedColumn = visibleColumns[Math.min(selection.left, visibleColumns.length - 1)];
    addColumnAt(selectedColumn?.sourceIndex ?? 0);
  };

  const edgeAddColumnAfter = () => {
    const selectedColumn = visibleColumns[Math.min(selection.right, visibleColumns.length - 1)];
    addColumnAt((selectedColumn?.sourceIndex ?? table.columns.length - 1) + 1);
  };

  const closeMenu = () => setMenuState(null);

  const menuContent = (() => {
    if (!menuState) {
      return null;
    }

    if (menuState.kind === 'column') {
      const columnRef = visibleColumns[menuState.visibleColIndex];
      if (!columnRef) {
        return null;
      }
      const { column, sourceIndex } = columnRef;
      const sort = activeView.sorts.find((item) => item.columnId === column.id);
      const filterItem = activeView.filters.find((item) => item.columnId === column.id);
      const canHide = visibleColumns.length > 1 && !columnParticipatesInMerge(table, sourceIndex);
      const typeLabel = COLUMN_TYPES.find((type) => type.value === column.type)?.label ?? '文本';

      return (
        <ColumnHeaderMenu
          canDelete={table.columns.length > 1}
          canHide={canHide}
          column={column}
          filterOperator={filterItem?.operator ?? null}
          left={menuState.clientX}
          sortDirection={sort?.direction ?? null}
          top={menuState.clientY}
          typeLabel={typeLabel}
          selectionActions={{
            canMerge,
            canSplit,
            onDeleteColumns: deleteSelectedColumns,
            onDeleteRows: deleteSelectedRows,
            onMerge: mergeSelection,
            onSplit: splitActiveCell
          }}
          onAddColumnAfter={() => addColumnAt(menuState.sourceIndex + 1)}
          onAddColumnBefore={() => addColumnAt(menuState.sourceIndex)}
          onDeleteColumn={() => deleteColumn(column.id, menuState.visibleColIndex)}
          onHideColumn={() => hideColumn(column.id)}
          onRequestClose={closeMenu}
          onSetFilter={(operator) => setColumnFilter(column.id, operator)}
          onSetSort={(direction) => setColumnSort(column.id, direction)}
          onUpdateType={(type) => updateColumnType(column.id, type)}
        />
      );
    }

    return (
      <RowHeaderMenu
        canDelete={table.rows.length > 1}
        left={menuState.clientX}
        rowLabel={menuState.displayRowIndex + 1}
        top={menuState.clientY}
        onAddRowAfter={() => addRowAt(menuState.rowIndex + 1)}
        onAddRowBefore={() => addRowAt(menuState.rowIndex)}
        onDeleteRow={() => deleteRow(menuState.rowIndex)}
        onRequestClose={closeMenu}
      />
    );
  })();

  const openColumnMenu = (
    event: React.MouseEvent,
    visibleColIndex: number,
    sourceIndex: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuState({
      clientX: event.clientX,
      clientY: event.clientY,
      kind: 'column',
      sourceIndex,
      visibleColIndex
    });
  };

  const openRowMenu = (event: React.MouseEvent, rowIndex: number, displayRowIndex: number) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuState({
      clientX: event.clientX,
      clientY: event.clientY,
      displayRowIndex,
      kind: 'row',
      rowIndex
    });
  };

  const deleteColumn = (columnId: string, visibleColIndex: number) => {
    if (table.columns.length <= 1) {
      return;
    }
    const next = cloneDataTable(table);
    next.columns = next.columns.filter((column) => column.id !== columnId);
    next.rows.forEach((row) => {
      delete row.cells[columnId];
    });
    next.views.forEach((view) => {
      view.hiddenColumnIds = view.hiddenColumnIds.filter((hiddenColumnId) => hiddenColumnId !== columnId);
      view.filters = view.filters.filter((filterItem) => filterItem.columnId !== columnId);
      view.sorts = view.sorts.filter((sort) => sort.columnId !== columnId);
    });
    commit(next);
    const nextCol = clampNumber(visibleColIndex, 0, Math.max(0, visibleColumns.length - 2));
    setAnchor({ row: Math.min(anchor.row, next.rows.length - 1), col: nextCol });
    setFocus({ row: Math.min(anchor.row, next.rows.length - 1), col: nextCol });
  };

  const deleteRow = (rowIndex: number) => {
    if (table.rows.length <= 1) {
      clearSelection();
      return;
    }
    const next = cloneDataTable(table);
    next.rows.splice(rowIndex, 1);
    commit(next);
    const nextRow = clampNumber(rowIndex, 0, Math.max(0, next.rows.length - 1));
    const nextCol = Math.min(anchor.col, Math.max(0, visibleColumns.length - 1));
    setAnchor({ row: nextRow, col: nextCol });
    setFocus({ row: nextRow, col: nextCol });
  };

  return (
    <NodeViewWrapper
      className={cn(
        'not-prose group/datatable my-4 block rounded-lg border border-slate-200 bg-white shadow-sm transition [&_table]:!m-0',
        selected && 'ring-2 ring-primary/25'
      )}
      contentEditable={false}
      data-allow-context-menu="true"
      data-neuink-datatable="true"
      onContextMenu={(event: React.MouseEvent) => {
        event.stopPropagation();
        if (!(event.target instanceof HTMLElement && event.target.closest('[data-datatable-menu-target="true"]'))) {
          event.preventDefault();
          setMenuState(null);
        }
      }}
      onPointerDown={(event: React.PointerEvent) => {
        if (!(event.target instanceof HTMLElement && event.target.closest('[data-datatable-menu="true"]'))) {
          setMenuState(null);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/35 px-2 py-1.5">
        <input
          aria-label="数据表标题"
          className="mr-1 h-7 min-w-32 bg-transparent px-1 text-xs font-semibold text-slate-700 outline-none focus:text-slate-950"
          value={table.title ?? 'DataTable'}
          onChange={(event) => updateTableTitle(event.currentTarget.value)}
        />
        <div
          className={cn(
            'ml-auto flex h-7 items-center gap-1 overflow-hidden rounded-md border bg-white px-2 opacity-0 transition-all group-hover/datatable:w-44 group-hover/datatable:opacity-100 focus-within:w-44 focus-within:opacity-100',
            activeView.search ? 'w-44 opacity-100' : 'w-7'
          )}
        >
          <Search size={13} aria-hidden="true" className="text-muted-foreground" />
          <input
            aria-label="搜索数据表"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            placeholder="搜索"
            value={activeView.search ?? ''}
            onChange={(event) => updateViewSearch(event.currentTarget.value)}
          />
        </div>
        {hiddenColumns.length > 0 && (
          <div className="ml-1 flex flex-wrap items-center gap-1 border-l pl-2">
            <span className="text-[11px] text-muted-foreground">隐藏列</span>
            {hiddenColumns.map((column) => (
              <button
                className="h-6 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-600 hover:bg-slate-50"
                key={column.id}
                type="button"
                onClick={() => showColumn(column.id)}
              >
                显示 {column.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        className="px-2 py-0"
        onPointerUp={() => setDragSelect(false)}
        onPointerLeave={() => setDragSelect(false)}
      >
        <div className="relative overflow-x-auto overflow-y-visible px-3 py-[9px] [&::-webkit-scrollbar:vertical]:hidden">
        <div className="group/datatable-grid relative inline-flex align-top leading-none">
          <EdgeAddButton
            ariaLabel="在上方添加行"
            className="left-1/2 top-0 h-[18px] w-[42px] -translate-x-1/2 -translate-y-1/2"
            onClick={() => addRowAt(selection.top)}
          />
          <EdgeAddButton
            ariaLabel="在下方添加行"
            className="left-1/2 top-full h-[18px] w-[42px] -translate-x-1/2 -translate-y-1/2"
            onClick={() => addRowAt(selection.bottom + 1)}
          />
          <EdgeAddButton
            ariaLabel="在左侧添加列"
            className="left-0 top-1/2 h-[42px] w-[18px] -translate-x-1/2 -translate-y-1/2"
            vertical
            onClick={edgeAddColumnBefore}
          />
          <EdgeAddButton
            ariaLabel="在右侧添加列"
            className="left-full top-1/2 h-[42px] w-[18px] -translate-x-1/2 -translate-y-1/2"
            vertical
            onClick={edgeAddColumnAfter}
          />
          <table
            className="!m-0 border-collapse text-sm"
            onDragEnd={finishTableDrag}
          >
          <colgroup>
            <col style={{ width: 36 }} />
            {visibleColumns.map(({ column }) => (
              <col key={column.id} style={{ width: widthForColumn(column, resizePreview) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="w-9 border border-slate-200 bg-slate-50" />
              {visibleColumns.map(({ column, sourceIndex }, visibleColIndex) => {
                const sort = activeView.sorts.find((item) => item.columnId === column.id);
                const filterItem = activeView.filters.find((item) => item.columnId === column.id);
                const canHide = visibleColumns.length > 1 && !columnParticipatesInMerge(table, sourceIndex);
                const typeLabel = COLUMN_TYPES.find((type) => type.value === column.type)?.label ?? '文本';
                return (
                  <th
                    className={cn(
                      'relative min-w-28 border border-slate-200 bg-slate-50 align-top',
                      tableDrag?.kind === 'column' && tableDrag.over === visibleColIndex && 'bg-primary/10'
                    )}
                    key={column.id}
                    style={{ width: widthForColumn(column, resizePreview) }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      if (tableDrag?.kind === 'column') {
                        setTableDrag({ ...tableDrag, over: visibleColIndex });
                      }
                    }}
                    onDragOver={(event) => {
                      if (tableDrag?.kind === 'column') {
                        event.preventDefault();
                      }
                    }}
                  >
                        <div
                          className="group/column-header flex min-h-14 items-center gap-1 px-2 py-1.5"
                          data-datatable-menu-target="true"
                          onContextMenu={(event) => openColumnMenu(event, visibleColIndex, sourceIndex)}
                        >
                          <button
                            aria-label="选择并拖拽列"
                            className={cn(
                              'flex h-6 w-5 cursor-grab items-center justify-center rounded text-slate-400 opacity-60 hover:bg-slate-100 hover:text-slate-600 group-hover/column-header:opacity-100',
                              tableHasMergedCells && 'cursor-not-allowed opacity-40'
                            )}
                            draggable={!tableHasMergedCells}
                            title={tableHasMergedCells ? '合并单元格存在时暂不拖拽列' : '拖拽列'}
                            type="button"
                            onClick={(event) => selectColumn(visibleColIndex, event.shiftKey)}
                            onDragStart={(event) => {
                              if (tableHasMergedCells) {
                                event.preventDefault();
                                return;
                              }
                              event.dataTransfer.effectAllowed = 'move';
                              setTableDrag({ kind: 'column', from: visibleColIndex, over: visibleColIndex });
                            }}
                          >
                            <GripHorizontal size={13} aria-hidden="true" />
                          </button>
                          <div className="min-w-0 flex-1">
                            <input
                              aria-label="字段名"
                              className="block min-w-0 w-full bg-transparent text-xs font-semibold leading-5 text-slate-700 outline-none focus:text-slate-950"
                              value={column.name}
                              onChange={(event) => updateColumnName(column.id, event.currentTarget.value)}
                              onFocus={() => selectCell({ row: anchor.row, col: visibleColIndex }, false)}
                            />
                            <div className="flex h-4 items-center gap-1 overflow-hidden text-[10px] font-normal leading-4 text-muted-foreground">
                              <span className="truncate">{typeLabel}</span>
                              {sort ? (
                                <span className="rounded bg-primary/10 px-1 text-primary">
                                  {sort.direction === 'asc' ? '升序' : '降序'}
                                </span>
                              ) : null}
                              {filterItem ? (
                                <span className="rounded bg-primary/10 px-1 text-primary">
                                  {filterLabel(filterItem.operator)}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                    <span
                      aria-label="调整列宽"
                      className="absolute bottom-0 right-0 top-0 w-2 cursor-col-resize hover:bg-primary/20"
                      role="separator"
                      onPointerDown={(event) => startColumnResize(event, column.id)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayedRows.length === 0 ? (
              <tr>
                <td
                  className="border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-muted-foreground"
                  colSpan={Math.max(1, visibleColumns.length + 1)}
                >
                  没有匹配的数据
                </td>
              </tr>
            ) : (
              displayedRows.map(({ row, sourceIndex: rowIndex }, displayRowIndex) => (
                <tr
                  className={cn(
                    tableDrag?.kind === 'row' && tableDrag.over === displayRowIndex && 'bg-primary/5'
                  )}
                  key={row.id}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    if (tableDrag?.kind === 'row') {
                      setTableDrag({ ...tableDrag, over: displayRowIndex });
                    }
                  }}
                  onDragOver={(event) => {
                      if (tableDrag?.kind === 'row') {
                        event.preventDefault();
                      }
                    }}
                >
                  <td className="w-9 border border-slate-200 bg-slate-50 p-0 text-center align-middle">
                    <button
                      aria-label="选择并拖拽行"
                      className={cn(
                        'flex h-full min-h-10 w-full cursor-grab items-center justify-center gap-0.5 text-[11px] text-slate-500 hover:bg-slate-100',
                        tableHasMergedCells && 'cursor-not-allowed opacity-40'
                      )}
                      data-datatable-menu-target="true"
                      draggable={!tableHasMergedCells}
                      title={tableHasMergedCells ? '合并单元格存在时暂不拖拽行' : '拖拽行'}
                      type="button"
                      onClick={(event) => selectRow(rowIndex, event.shiftKey)}
                      onContextMenu={(event) => openRowMenu(event, rowIndex, displayRowIndex)}
                      onDragStart={(event) => {
                        if (tableHasMergedCells) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.effectAllowed = 'move';
                        setTableDrag({ kind: 'row', from: displayRowIndex, over: displayRowIndex });
                      }}
                    >
                      <GripVertical size={13} aria-hidden="true" />
                      {displayRowIndex + 1}
                    </button>
                  </td>
                  {visibleColumns.map(({ column, sourceIndex }, visibleColIndex) => {
                    const cell = row.cells[column.id];
                    if (!cell || cell.hidden) {
                      return null;
                    }
                    const isSelected = pointInRect({ row: rowIndex, col: visibleColIndex }, selection);
                    return (
                      <td
                        className={cn(
                          'min-w-28 border border-slate-200 bg-white align-top',
                          column.align === 'center' && 'text-center',
                          column.align === 'right' && 'text-right',
                          isSelected && 'bg-primary/5 ring-1 ring-inset ring-primary/30'
                        )}
                        colSpan={visibleColspan(cell, sourceIndex, visibleColumns)}
                        key={cell.id}
                        rowSpan={cell.rowspan}
                        onPointerDown={(event) => {
                          if (event.button !== 0 || interactiveTarget(event.target)) {
                            return;
                          }
                          selectCell({ row: rowIndex, col: visibleColIndex }, event.shiftKey);
                          setDragSelect(true);
                        }}
                        onPointerEnter={(event) => {
                          if (dragSelect && event.buttons === 1) {
                            setFocus({ row: rowIndex, col: visibleColIndex });
                          }
                        }}
                      >
                        {renderCellEditor({
                          cell,
                          column,
                          isSelected,
                          onClearSelection: clearSelection,
                          onMoveSelection: moveSelection,
                          onSelect: (extend) => selectCell({ row: rowIndex, col: visibleColIndex }, extend),
                          onUpdate: (value) => updateCellValue(rowIndex, visibleColIndex, value),
                          selectedCellCount
                        })}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
      </div>
      {menuContent}
    </NodeViewWrapper>
  );
}
