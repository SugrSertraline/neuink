import type { JSONContent } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

import { DataTableNodeView } from './DataTableNodeView';

export type DataTableColumnType =
  | 'checkbox'
  | 'date'
  | 'number'
  | 'select'
  | 'status'
  | 'text'
  | 'url';

export type DataTableCellValue = boolean | number | string | null;

export type DataTableCell = {
  colspan?: number;
  hidden?: boolean;
  id: string;
  rowspan?: number;
  value: DataTableCellValue;
};

export type DataTableColumnOption = {
  color?: string;
  id: string;
  name: string;
};

export type DataTableColumn = {
  align?: 'center' | 'left' | 'right';
  hidden?: boolean;
  id: string;
  name: string;
  options?: DataTableColumnOption[];
  type: DataTableColumnType;
  width: number;
};

export type DataTableRow = {
  cells: Record<string, DataTableCell>;
  id: string;
};

export type DataTableFilter = {
  columnId: string;
  id: string;
  operator: 'contains' | 'equals' | 'is_empty' | 'is_not_empty';
  value?: DataTableCellValue;
};

export type DataTableSort = {
  columnId: string;
  direction: 'asc' | 'desc';
  id: string;
};

export type DataTableViewConfig = {
  filters: DataTableFilter[];
  frozenColumnCount?: number;
  hiddenColumnIds: string[];
  id: string;
  kind: 'table';
  name: string;
  search?: string;
  sorts: DataTableSort[];
};

export type DataTableDocument = {
  activeViewId: string;
  columns: DataTableColumn[];
  rows: DataTableRow[];
  settings: {
    firstColumnIsHeader: boolean;
    firstRowIsHeader: boolean;
  };
  title?: string;
  version: 2;
  views: DataTableViewConfig[];
};

type LegacyDataTableCell = Partial<DataTableCell> & {
  text?: string;
};

type LegacyDataTableColumn = Partial<DataTableColumn>;

type LegacyDataTableRow = {
  cells?: LegacyDataTableCell[] | Record<string, LegacyDataTableCell>;
  id?: string;
};

type LegacyDataTableDocument = Partial<Omit<DataTableDocument, 'columns' | 'rows' | 'version'>> & {
  columns?: LegacyDataTableColumn[];
  rows?: LegacyDataTableRow[];
  version?: number;
};

type DataTableToken = {
  raw?: string;
  table?: DataTableDocument;
  text?: string;
  type: string;
};

const DATA_TABLE_FENCE = 'neuink-datatable';
const DEFAULT_COLUMN_WIDTH = 160;
const DEFAULT_VIEW_ID = 'view_default';

export const DataTableNode = Node.create({
  name: 'dataTable',

  priority: 1000,

  group: 'block',

  atom: true,
  draggable: true,
  isolating: true,
  selectable: true,

  addAttributes() {
    return {
      data: {
        default: createDefaultDataTable(),
        parseHTML: (element: HTMLElement) => parseDataTableJson(element.textContent ?? ''),
        renderHTML: (attributes: { data?: DataTableDocument }) => ({
          'data-table-json': JSON.stringify(normalizeDataTable(attributes.data))
        })
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'neuink-datatable'
      }
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    const data = normalizeDataTable(HTMLAttributes.data as DataTableDocument | undefined);
    return [
      'neuink-datatable',
      mergeAttributes(HTMLAttributes, {
        'data-neuink-datatable': 'true'
      }),
      JSON.stringify(data)
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DataTableNodeView);
  },

  renderMarkdown: (node: JSONContent) => {
    const data = normalizeDataTable(node.attrs?.data as DataTableDocument | undefined);
    return `\`\`\`${DATA_TABLE_FENCE}\n${JSON.stringify(data, null, 2)}\n\`\`\``;
  },

  markdownTokenizer: {
    name: 'dataTable',
    level: 'block',
    start(src: string) {
      const match = src.match(/```neuink-datatable/);
      return match?.index ?? -1;
    },
    tokenize(src: string) {
      const match = /^```neuink-datatable[^\n]*\n([\s\S]*?)(?:\n```|$)/.exec(src);
      if (!match) {
        return undefined;
      }

      const raw = match[0];
      const text = match[1] ?? '';
      return {
        type: 'dataTable',
        raw,
        text,
        table: parseDataTableJson(text)
      };
    }
  },

  parseMarkdown: (token: DataTableToken, helpers: { createNode: (type: string, attrs?: Record<string, unknown>) => JSONContent }) =>
    helpers.createNode('dataTable', {
      data: normalizeDataTable(token.table ?? parseDataTableJson(token.text ?? ''))
    })
} as Record<string, unknown>);

export function createDefaultDataTable(rows = 3, columns = 3): DataTableDocument {
  const columnCount = Math.max(1, columns);
  const rowCount = Math.max(1, rows);
  const tableColumns = Array.from({ length: columnCount }, (_, index) => ({
    id: makeDataTableId('col', index),
    name: `Column ${index + 1}`,
    type: 'text' as const,
    width: DEFAULT_COLUMN_WIDTH
  }));

  return normalizeDataTable({
    version: 2,
    activeViewId: DEFAULT_VIEW_ID,
    columns: tableColumns,
    rows: Array.from({ length: rowCount }, (_, rowIndex) => ({
      id: makeDataTableId('row', rowIndex),
      cells: Object.fromEntries(
        tableColumns.map((column, colIndex) => [
          column.id,
          {
            id: makeDataTableId(`cell-${rowIndex}`, colIndex),
            value: ''
          }
        ])
      )
    })),
    settings: {
      firstColumnIsHeader: false,
      firstRowIsHeader: true
    },
    views: [createDefaultView()]
  });
}

export function normalizeDataTable(value?: LegacyDataTableDocument | null): DataTableDocument {
  const inputColumns = Array.isArray(value?.columns) ? value.columns : [];
  const inputRows = Array.isArray(value?.rows) ? value.rows : [];
  const legacyRowCellCounts = inputRows.map((row) =>
    Array.isArray(row.cells) ? row.cells.length : row.cells ? Object.keys(row.cells).length : 0
  );
  const columnCount = Math.max(1, inputColumns.length, ...legacyRowCellCounts);

  const columns = Array.from({ length: columnCount }, (_, index): DataTableColumn => {
    const column = inputColumns[index];
    return {
      id: safeId(column?.id, 'col', index),
      name: safeString(column?.name, `Column ${index + 1}`),
      type: normalizeColumnType(column?.type),
      width: normalizeWidth(column?.width),
      align: normalizeAlign(column?.align),
      hidden: Boolean(column?.hidden),
      options: normalizeOptions(column?.options)
    };
  });

  const rows = (inputRows.length > 0 ? inputRows : createDefaultDataTable(1, columnCount).rows).map(
    (row, rowIndex): DataTableRow => ({
      id: safeId(row?.id, 'row', rowIndex),
      cells: Object.fromEntries(
        columns.map((column, colIndex) => {
          const cell = getLegacyCell(row, column.id, colIndex);
          return [
            column.id,
            {
              id: safeId(cell?.id, `cell-${rowIndex}`, colIndex),
              value: normalizeCellValue(cell, column.type),
              rowspan: clampSpan(cell?.rowspan),
              colspan: clampSpan(cell?.colspan),
              hidden: Boolean(cell?.hidden)
            }
          ];
        })
      )
    })
  );

  const defaultView = createDefaultView();
  const views = normalizeViews(value?.views, defaultView, columns);
  const activeViewId = views.some((view) => view.id === value?.activeViewId)
    ? String(value?.activeViewId)
    : views[0]?.id ?? defaultView.id;

  const table: DataTableDocument = {
    version: 2,
    title: typeof value?.title === 'string' ? value.title : undefined,
    activeViewId,
    columns,
    rows,
    settings: {
      firstColumnIsHeader: Boolean(value?.settings?.firstColumnIsHeader),
      firstRowIsHeader: value?.settings?.firstRowIsHeader !== false
    },
    views
  };
  return repairHiddenCells(table);
}

export function cloneDataTable(value: DataTableDocument) {
  return normalizeDataTable(JSON.parse(JSON.stringify(value)) as DataTableDocument);
}

export function createEmptyDataTableCell(columnType: DataTableColumnType, prefix: string, index = 0): DataTableCell {
  return {
    id: makeDataTableId(prefix, index),
    value: defaultValueForColumnType(columnType)
  };
}

export function makeDataTableId(prefix: string, index = 0) {
  return `${prefix}_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 7)}`;
}

function createDefaultView(): DataTableViewConfig {
  return {
    id: DEFAULT_VIEW_ID,
    kind: 'table',
    name: 'Table',
    filters: [],
    hiddenColumnIds: [],
    sorts: []
  };
}

function parseDataTableJson(value: string) {
  try {
    return normalizeDataTable(JSON.parse(value) as LegacyDataTableDocument);
  } catch {
    return createDefaultDataTable();
  }
}

function repairHiddenCells(table: DataTableDocument) {
  const rowCount = table.rows.length;
  const colCount = table.columns.length;
  const covered = new Set<string>();

  for (const row of table.rows) {
    for (const column of table.columns) {
      const cell = row.cells[column.id];
      if (cell) {
        cell.hidden = false;
      }
    }
  }

  table.rows.forEach((row, rowIndex) => {
    table.columns.forEach((column, colIndex) => {
      const cell = row.cells[column.id];
      if (!cell) {
        return;
      }
      if (covered.has(cellKey(rowIndex, colIndex))) {
        cell.hidden = true;
        cell.rowspan = 1;
        cell.colspan = 1;
        return;
      }

      const rowspan = Math.min(clampSpan(cell.rowspan), rowCount - rowIndex);
      const colspan = Math.min(clampSpan(cell.colspan), colCount - colIndex);
      cell.rowspan = rowspan;
      cell.colspan = colspan;

      for (let y = rowIndex; y < rowIndex + rowspan; y += 1) {
        for (let x = colIndex; x < colIndex + colspan; x += 1) {
          if (y === rowIndex && x === colIndex) {
            continue;
          }
          covered.add(cellKey(y, x));
          const coveredColumnId = table.columns[x]?.id;
          const coveredCell = coveredColumnId ? table.rows[y]?.cells[coveredColumnId] : null;
          if (coveredCell) {
            coveredCell.hidden = true;
            coveredCell.rowspan = 1;
            coveredCell.colspan = 1;
          }
        }
      }
    });
  });

  return table;
}

function getLegacyCell(row: LegacyDataTableRow | DataTableRow, columnId: string, colIndex: number) {
  const cells = row?.cells;
  if (Array.isArray(cells)) {
    return cells[colIndex] ?? null;
  }
  return cells?.[columnId] ?? null;
}

function normalizeCellValue(cell: LegacyDataTableCell | null, columnType: DataTableColumnType): DataTableCellValue {
  const rawValue = cell && 'value' in cell ? cell.value : cell?.text;
  if (rawValue === null || rawValue === undefined) {
    return defaultValueForColumnType(columnType);
  }

  switch (columnType) {
    case 'checkbox':
      return Boolean(rawValue);
    case 'number': {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : null;
    }
    default:
      return String(rawValue);
  }
}

function defaultValueForColumnType(type: DataTableColumnType): DataTableCellValue {
  if (type === 'checkbox') {
    return false;
  }
  if (type === 'number') {
    return null;
  }
  return '';
}

function normalizeViews(
  value: DataTableViewConfig[] | undefined,
  defaultView: DataTableViewConfig,
  columns: DataTableColumn[]
) {
  const columnIds = new Set(columns.map((column) => column.id));
  const views = Array.isArray(value) && value.length > 0 ? value : [defaultView];
  return views.map((view, index): DataTableViewConfig => ({
    id: safeId(view?.id, 'view', index),
    kind: 'table',
    name: safeString(view?.name, index === 0 ? 'Table' : `View ${index + 1}`),
    search: typeof view?.search === 'string' ? view.search : undefined,
    frozenColumnCount: normalizeFrozenColumnCount(view?.frozenColumnCount, columns.length),
    hiddenColumnIds: normalizeHiddenColumnIds(view?.hiddenColumnIds, columnIds),
    filters: normalizeFilters(view?.filters, columnIds),
    sorts: normalizeSorts(view?.sorts, columnIds)
  }));
}

function normalizeHiddenColumnIds(value: unknown, columnIds: Set<string>) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(value.filter((id): id is string => typeof id === 'string' && columnIds.has(id)))
  );
}

function normalizeFilters(value: unknown, columnIds: Set<string>): DataTableFilter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((filter, index): DataTableFilter[] => {
    if (!filter || typeof filter !== 'object') {
      return [];
    }
    const candidate = filter as Partial<DataTableFilter>;
    if (typeof candidate.columnId !== 'string' || !columnIds.has(candidate.columnId)) {
      return [];
    }
    return [
      {
        id: safeId(candidate.id, 'filter', index),
        columnId: candidate.columnId,
        operator: normalizeFilterOperator(candidate.operator),
        value: candidate.value === undefined ? undefined : normalizeFilterValue(candidate.value)
      }
    ];
  });
}

function normalizeSorts(value: unknown, columnIds: Set<string>): DataTableSort[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((sort, index): DataTableSort[] => {
    if (!sort || typeof sort !== 'object') {
      return [];
    }
    const candidate = sort as Partial<DataTableSort>;
    if (typeof candidate.columnId !== 'string' || !columnIds.has(candidate.columnId)) {
      return [];
    }
    return [
      {
        id: safeId(candidate.id, 'sort', index),
        columnId: candidate.columnId,
        direction: candidate.direction === 'desc' ? 'desc' : 'asc'
      }
    ];
  });
}

function normalizeFilterOperator(value: unknown): DataTableFilter['operator'] {
  switch (value) {
    case 'equals':
    case 'is_empty':
    case 'is_not_empty':
      return value;
    default:
      return 'contains';
  }
}

function normalizeFilterValue(value: unknown): DataTableCellValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

function cellKey(row: number, col: number) {
  return `${row}:${col}`;
}

function clampSpan(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(99, Math.round(parsed))) : 1;
}

function normalizeWidth(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(80, Math.min(640, Math.round(parsed)))
    : DEFAULT_COLUMN_WIDTH;
}

function normalizeFrozenColumnCount(value: unknown, columnCount: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(columnCount, Math.round(parsed))) : undefined;
}

function normalizeColumnType(value: unknown): DataTableColumnType {
  switch (value) {
    case 'checkbox':
    case 'date':
    case 'number':
    case 'select':
    case 'status':
    case 'url':
      return value;
    default:
      return 'text';
  }
}

function normalizeAlign(value: unknown) {
  switch (value) {
    case 'center':
    case 'right':
      return value;
    default:
      return 'left';
  }
}

function normalizeOptions(value: unknown): DataTableColumnOption[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((option, index) => ({
    id: safeId(option?.id, 'option', index),
    name: safeString(option?.name, `Option ${index + 1}`),
    color: typeof option?.color === 'string' ? option.color : undefined
  }));
}

function safeId(value: unknown, prefix: string, index: number) {
  return typeof value === 'string' && value.trim() ? value : makeDataTableId(prefix, index);
}

function safeString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}
