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


export function renderCellEditor({
  cell,
  column,
  onClearSelection,
  onMoveSelection,
  onSelect,
  onUpdate,
  selectedCellCount
}: {
  cell: DataTableCell;
  column: DataTableColumn;
  isSelected: boolean;
  onClearSelection: () => void;
  onMoveSelection: (rowDelta: number, colDelta: number) => void;
  onSelect: (extend: boolean) => void;
  onUpdate: (value: DataTableCellValue) => void;
  selectedCellCount: number;
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if ((event.key === 'Backspace' || event.key === 'Delete') && selectedCellCount > 1) {
      event.preventDefault();
      onClearSelection();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      onMoveSelection(0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && column.type !== 'text') {
      event.preventDefault();
      onMoveSelection(1, 0);
    }
  };

  const commonClass =
    'block min-h-10 w-full bg-transparent px-2 py-1.5 text-sm leading-5 outline-none placeholder:text-slate-300';
  const commonProps = {
    onClick: (event: React.MouseEvent<HTMLElement>) => onSelect(event.shiftKey),
    onFocus: () => onSelect(false),
    onKeyDown: handleKeyDown
  };

  if (column.type === 'checkbox') {
    return (
      <label className="flex min-h-10 items-center justify-center px-2 py-1.5">
        <input
          checked={Boolean(cell.value)}
          className="h-4 w-4"
          type="checkbox"
          onChange={(event) => onUpdate(event.currentTarget.checked)}
          {...commonProps}
        />
      </label>
    );
  }

  if (column.type === 'number') {
    return (
      <input
        className={commonClass}
        inputMode="decimal"
        type="number"
        value={typeof cell.value === 'number' ? String(cell.value) : ''}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          onUpdate(raw === '' ? null : Number(raw));
        }}
        {...commonProps}
      />
    );
  }

  if (column.type === 'date') {
    return (
      <input
        className={commonClass}
        type="date"
        value={dateInputValue(cell.value)}
        onChange={(event) => onUpdate(event.currentTarget.value)}
        {...commonProps}
      />
    );
  }

  if (column.type === 'url') {
    return (
      <input
        className={commonClass}
        placeholder="https://"
        type="url"
        value={cellDisplayText(cell)}
        onChange={(event) => onUpdate(event.currentTarget.value)}
        {...commonProps}
      />
    );
  }

  if (column.type === 'select' || column.type === 'status') {
    return (
      <input
        className={cn(
          commonClass,
          column.type === 'status' && 'font-medium text-primary',
          column.type === 'select' && 'text-slate-700'
        )}
        placeholder={column.type === 'status' ? '状态' : '选项'}
        value={cellDisplayText(cell)}
        onChange={(event) => onUpdate(event.currentTarget.value)}
        {...commonProps}
      />
    );
  }

  return (
    <textarea
      className={cn(commonClass, 'min-h-16 resize-none')}
      value={cellDisplayText(cell)}
      onChange={(event) => onUpdate(event.currentTarget.value)}
      {...commonProps}
    />
  );
}

export function ColumnHeaderMenu({
  canDelete,
  canHide,
  column,
  filterOperator,
  left,
  onAddColumnAfter,
  onAddColumnBefore,
  onDeleteColumn,
  onHideColumn,
  onRequestClose,
  onSetFilter,
  onSetSort,
  onUpdateType,
  selectionActions,
  sortDirection,
  top,
  typeLabel
}: {
  canDelete: boolean;
  canHide: boolean;
  column: DataTableColumn;
  filterOperator: DataTableViewConfig['filters'][number]['operator'] | null;
  left: number;
  onAddColumnAfter: () => void;
  onAddColumnBefore: () => void;
  onDeleteColumn: () => void;
  onHideColumn: () => void;
  onRequestClose: () => void;
  onSetFilter: (operator: DataTableViewConfig['filters'][number]['operator'] | null) => void;
  onSetSort: (direction: DataTableViewConfig['sorts'][number]['direction'] | null) => void;
  onUpdateType: (type: DataTableColumnType) => void;
  selectionActions: {
    canMerge: boolean;
    canSplit: boolean;
    onDeleteColumns: () => void;
    onDeleteRows: () => void;
    onMerge: () => void;
    onSplit: () => void;
  };
  sortDirection: DataTableViewConfig['sorts'][number]['direction'] | null;
  top: number;
  typeLabel: string;
}) {
  useEffect(() => {
    const close = () => onRequestClose();
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);

    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [onRequestClose]);

  const run = (action: () => void) => {
    action();
    onRequestClose();
  };

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed z-[var(--z-menu)] w-56 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      data-allow-context-menu="true"
      data-datatable-menu="true"
      style={{
        left: `clamp(0.5rem, ${left}px, calc(100vw - 15rem))`,
        top: `clamp(0.5rem, ${top}px, calc(100vh - 24rem))`
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">{column.name || '字段'}</div>
      <div className="px-1.5 py-1 text-[11px] text-muted-foreground">类型</div>
      <div className="grid grid-cols-2 gap-1 px-1">
        {COLUMN_TYPES.map((type) => (
          <MenuButton
            active={column.type === type.value}
            key={type.value}
            onClick={() => run(() => onUpdateType(type.value))}
          >
            {type.label}
          </MenuButton>
        ))}
      </div>
      <MenuSeparator />
      <div className="grid grid-cols-3 gap-1 px-1">
        <MenuButton active={!sortDirection} onClick={() => run(() => onSetSort(null))}>
          无排序
        </MenuButton>
        <MenuButton active={sortDirection === 'asc'} onClick={() => run(() => onSetSort('asc'))}>
          升序
        </MenuButton>
        <MenuButton active={sortDirection === 'desc'} onClick={() => run(() => onSetSort('desc'))}>
          降序
        </MenuButton>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1 px-1">
        <MenuButton active={!filterOperator} onClick={() => run(() => onSetFilter(null))}>
          无筛选
        </MenuButton>
        <MenuButton active={filterOperator === 'is_not_empty'} onClick={() => run(() => onSetFilter('is_not_empty'))}>
          非空
        </MenuButton>
        <MenuButton active={filterOperator === 'is_empty'} onClick={() => run(() => onSetFilter('is_empty'))}>
          空值
        </MenuButton>
      </div>
      <MenuSeparator />
      <MenuItem icon={<Plus size={14} aria-hidden="true" />} onClick={() => run(onAddColumnBefore)}>
        左侧插入列
      </MenuItem>
      <MenuItem icon={<Plus size={14} aria-hidden="true" />} onClick={() => run(onAddColumnAfter)}>
        右侧插入列
      </MenuItem>
      <MenuItem disabled={!canHide} icon={<EyeOff size={14} aria-hidden="true" />} onClick={() => run(onHideColumn)}>
        隐藏列
      </MenuItem>
      <MenuSeparator />
      <MenuItem disabled={!selectionActions.canMerge} onClick={() => run(selectionActions.onMerge)}>
        合并选区
      </MenuItem>
      <MenuItem disabled={!selectionActions.canSplit} onClick={() => run(selectionActions.onSplit)}>
        拆分单元格
      </MenuItem>
      <MenuItem onClick={() => run(selectionActions.onDeleteRows)}>删除选中行</MenuItem>
      <MenuItem onClick={() => run(selectionActions.onDeleteColumns)}>删除选中列</MenuItem>
      <MenuSeparator />
      <MenuItem
        danger
        disabled={!canDelete}
        icon={<Trash2 size={14} aria-hidden="true" />}
        onClick={() => run(onDeleteColumn)}
      >
        删除列
      </MenuItem>
    </div>,
    document.body
  );
}

export function RowHeaderMenu({
  canDelete,
  left,
  onAddRowAfter,
  onAddRowBefore,
  onDeleteRow,
  onRequestClose,
  rowLabel,
  top
}: {
  canDelete: boolean;
  left: number;
  onAddRowAfter: () => void;
  onAddRowBefore: () => void;
  onDeleteRow: () => void;
  onRequestClose: () => void;
  rowLabel: number;
  top: number;
}) {
  useEffect(() => {
    const close = () => onRequestClose();
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);

    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [onRequestClose]);

  const run = (action: () => void) => {
    action();
    onRequestClose();
  };

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed z-[var(--z-menu)] w-36 rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10"
      data-allow-context-menu="true"
      data-datatable-menu="true"
      style={{
        left: `clamp(0.5rem, ${left}px, calc(100vw - 10rem))`,
        top: `clamp(0.5rem, ${top}px, calc(100vh - 10rem))`
      }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">第 {rowLabel} 行</div>
      <MenuItem icon={<Plus size={14} aria-hidden="true" />} onClick={() => run(onAddRowBefore)}>
        上方插入行
      </MenuItem>
      <MenuItem icon={<Plus size={14} aria-hidden="true" />} onClick={() => run(onAddRowAfter)}>
        下方插入行
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        danger
        disabled={!canDelete}
        icon={<Trash2 size={14} aria-hidden="true" />}
        onClick={() => run(onDeleteRow)}
      >
        删除行
      </MenuItem>
    </div>,
    document.body
  );
}

export function MenuItem({
  children,
  danger = false,
  disabled = false,
  icon,
  onClick
}: {
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
        danger && 'text-destructive hover:bg-destructive/10 hover:text-destructive'
      )}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  );
}

export function MenuButton({
  active = false,
  children,
  onClick
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        active && 'bg-primary/10 text-primary'
      )}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="-mx-1 my-1 h-px bg-border" />;
}

export function EdgeAddButton({
  ariaLabel,
  className,
  onClick,
  vertical = false
}: {
  ariaLabel: string;
  className: string;
  onClick: () => void;
  vertical?: boolean;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={cn(
        'absolute z-30 flex items-center justify-center rounded-md border border-primary/25 bg-white text-primary/75 opacity-0 shadow-sm transition hover:border-primary/45 hover:bg-primary/5 hover:text-primary group-hover/datatable-grid:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        vertical ? '[&>svg]:rotate-90' : '',
        className
      )}
      data-table-edge-control="true"
      title={ariaLabel}
      type="button"
      onClick={onClick}
    >
      <Plus className="pointer-events-none" size={11} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

export function getActiveView(table: DataTableDocument) {
  return table.views.find((view) => view.id === table.activeViewId) ?? table.views[0];
}

export function getDisplayedRows(
  table: DataTableDocument,
  view: DataTableViewConfig,
  visibleColumns: VisibleColumn[]
): DisplayRow[] {
  const columnsById = new Map(table.columns.map((column) => [column.id, column]));
  const search = view.search?.trim().toLocaleLowerCase() ?? '';
  const rows = table.rows
    .map((row, sourceIndex) => ({ row, sourceIndex }))
    .filter(({ row }) => rowPassesFilters(row, view, columnsById))
    .filter(({ row }) => {
      if (!search) {
        return true;
      }
      return visibleColumns.some(({ column }) =>
        cellDisplayText(row.cells[column.id]).toLocaleLowerCase().includes(search)
      );
    });

  const sort = view.sorts[0];
  if (!sort) {
    return rows;
  }

  const sortColumn = columnsById.get(sort.columnId);
  if (!sortColumn) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    const comparison = compareCellValues(
      left.row.cells[sort.columnId]?.value,
      right.row.cells[sort.columnId]?.value,
      sortColumn.type
    );
    if (comparison === 0) {
      return left.sourceIndex - right.sourceIndex;
    }
    return sort.direction === 'asc' ? comparison : -comparison;
  });
}

export function rowPassesFilters(
  row: DataTableRow,
  view: DataTableViewConfig,
  columnsById: Map<string, DataTableColumn>
) {
  return view.filters.every((filterItem) => {
    const column = columnsById.get(filterItem.columnId);
    const cell = row.cells[filterItem.columnId];
    if (!column || !cell) {
      return true;
    }
    const text = cellDisplayText(cell);
    if (filterItem.operator === 'is_empty') {
      return valueIsEmpty(cell.value);
    }
    if (filterItem.operator === 'is_not_empty') {
      return !valueIsEmpty(cell.value);
    }
    if (filterItem.operator === 'equals') {
      return text === String(filterItem.value ?? '');
    }
    return text.toLocaleLowerCase().includes(String(filterItem.value ?? '').toLocaleLowerCase());
  });
}

export function rectFromPoints(left: CellPoint, right: CellPoint): CellRect {
  return {
    top: Math.min(left.row, right.row),
    bottom: Math.max(left.row, right.row),
    left: Math.min(left.col, right.col),
    right: Math.max(left.col, right.col)
  };
}

export function pointInRect(point: CellPoint, rect: CellRect) {
  return point.row >= rect.top && point.row <= rect.bottom && point.col >= rect.left && point.col <= rect.right;
}

export function eachVisibleCell(
  table: DataTableDocument,
  rect: CellRect,
  visibleColumns: VisibleColumn[],
  callback: (cell: DataTableCell, column: DataTableColumn) => void
) {
  for (let row = rect.top; row <= rect.bottom; row += 1) {
    for (const { column } of selectedVisibleColumns(rect, visibleColumns)) {
      const cell = table.rows[row]?.cells[column.id] ?? null;
      if (cell && !cell.hidden) {
        callback(cell, column);
      }
    }
  }
}

export function selectedVisibleColumns(rect: CellRect, visibleColumns: VisibleColumn[]) {
  return visibleColumns.slice(rect.left, rect.right + 1);
}

export function countVisibleCells(table: DataTableDocument, rect: CellRect, visibleColumns: VisibleColumn[]) {
  let count = 0;
  eachVisibleCell(table, rect, visibleColumns, () => {
    count += 1;
  });
  return count;
}

export function isMergeableRect(table: DataTableDocument, rect: CellRect, visibleColumns: VisibleColumn[]) {
  const selectedColumns = selectedVisibleColumns(rect, visibleColumns);
  if (selectedColumns.length === 0 || !sourceColumnsAreContiguous(selectedColumns)) {
    return false;
  }
  for (let row = rect.top; row <= rect.bottom; row += 1) {
    for (const { column } of selectedColumns) {
      const cell = table.rows[row]?.cells[column.id] ?? null;
      if (!cell || cell.hidden || (cell.rowspan ?? 1) !== 1 || (cell.colspan ?? 1) !== 1) {
        return false;
      }
    }
  }
  return true;
}

export function sourceColumnsAreContiguous(columns: VisibleColumn[]) {
  return columns.every((column, index) => index === 0 || column.sourceIndex === columns[index - 1].sourceIndex + 1);
}

export function visibleColspan(cell: DataTableCell, sourceIndex: number, visibleColumns: VisibleColumn[]) {
  const colspan = cell.colspan ?? 1;
  const right = sourceIndex + colspan - 1;
  return Math.max(
    1,
    visibleColumns.filter((column) => column.sourceIndex >= sourceIndex && column.sourceIndex <= right).length
  );
}

export function columnParticipatesInMerge(table: DataTableDocument, sourceIndex: number) {
  return table.rows.some((row) =>
    table.columns.some((column, columnIndex) => {
      const cell = row.cells[column.id];
      if (!cell || cell.hidden) {
        return false;
      }
      const rowspan = cell.rowspan ?? 1;
      const colspan = cell.colspan ?? 1;
      return (rowspan > 1 || colspan > 1) && sourceIndex >= columnIndex && sourceIndex < columnIndex + colspan;
    })
  );
}

export function hasMergedCells(table: DataTableDocument) {
  return table.rows.some((row) =>
    table.columns.some((column) => {
      const cell = row.cells[column.id];
      return Boolean(cell && !cell.hidden && ((cell.rowspan ?? 1) > 1 || (cell.colspan ?? 1) > 1));
    })
  );
}

export function interactiveTarget(target: EventTarget) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'button,input,textarea,select,[role="button"],[role="combobox"],[role="separator"],[data-slot]'
      )
    )
  );
}

export function cellDisplayText(cell: DataTableCell | undefined) {
  if (!cell || cell.value === null || cell.value === undefined) {
    return '';
  }
  return String(cell.value);
}

export function coerceCellValue(value: DataTableCellValue, type: DataTableColumnType): DataTableCellValue {
  if (type === 'checkbox') {
    return Boolean(value);
  }
  if (type === 'number') {
    if (value === null || value === '') {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return value === null || value === undefined ? '' : String(value);
}

export function compareCellValues(
  left: DataTableCellValue | undefined,
  right: DataTableCellValue | undefined,
  type: DataTableColumnType
) {
  if (type === 'number') {
    return Number(left ?? Number.NEGATIVE_INFINITY) - Number(right ?? Number.NEGATIVE_INFINITY);
  }
  if (type === 'checkbox') {
    return Number(Boolean(left)) - Number(Boolean(right));
  }
  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true });
}

export function valueIsEmpty(value: DataTableCellValue) {
  return value === null || value === undefined || value === '' || value === false;
}

export function dateInputValue(value: DataTableCellValue) {
  const text = typeof value === 'string' ? value : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

export function widthForColumn(column: DataTableColumn | undefined, resizePreview: ResizePreview | null) {
  if (!column) {
    return 160;
  }
  return resizePreview?.columnId === column.id ? resizePreview.width : column.width;
}

export function clampColumnWidth(value: number) {
  return clampNumber(Math.round(value), 90, 640);
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function moveArrayItem<T>(items: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return;
  }
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item);
}

export function filterLabel(operator: DataTableViewConfig['filters'][number]['operator'] | undefined) {
  if (operator === 'is_not_empty') {
    return '非空';
  }
  if (operator === 'is_empty') {
    return '空值';
  }
  return '';
}

