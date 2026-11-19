// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ENTRY_LIBRARY_COLUMNS, LibraryPaperTable, fieldColumnId } from './LibraryPaperTable';
import { ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY } from './useEntryLibraryColumnWidths';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
}
beforeEach(() => { window.localStorage.clear(); HTMLElement.prototype.scrollIntoView = vi.fn(); vi.stubGlobal('PointerEvent', TestPointerEvent); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function showTable(overrides: Partial<ComponentProps<typeof LibraryPaperTable>> = {}) {
  const props: ComponentProps<typeof LibraryPaperTable> = {
    active: true, entries: [{ id: 'paper', title: 'A long paper title', contents: [], tags: [], tagIds: [], fields: {},
      createdAt: '', updatedAt: '', pdfFileName: 'paper.pdf', parseEndpoint: null, parseMessage: null, status: 'Parsed', progress: 100 }],
    status: 'ready', emptyMessage: '暂无论文', readingStates: {}, selectedEntryId: null, draggingEntryId: null,
    visibleColumns: new Set(ENTRY_LIBRARY_COLUMNS.map(column => column.id)), pinnedEdges: new Set(['left', 'right']),
    reparseDisabled: false, getRowProps: () => ({}), onOpen: vi.fn(), onOpenInSidePane: vi.fn(), onReparse: vi.fn(), onDelete: vi.fn(), ...overrides
  };
  const view = render(<LibraryPaperTable {...props} />, { wrapper: ({ children }) => <TooltipProvider>{children}</TooltipProvider> });
  const table = screen.getByRole('table');
  const resize = (width: number) => {
    Object.defineProperty(table.parentElement, 'clientWidth', { configurable: true, value: width });
    fireEvent(window, new Event('resize'));
  };
  const widths = () => Array.from(table.querySelectorAll('col')).map(col => Number.parseFloat(col.style.width));
  return { table, resize, widths, rerender: (patch: Partial<typeof props>) => view.rerender(<LibraryPaperTable {...props} {...patch} />) };
}

describe('library table width fitting', () => {
  it('cancels a left pinned resize when the viewport changes', () => {
    const { resize, widths } = showTable(); resize(1100);
    const handle = screen.getByRole('separator', { name: '调整“标题”列宽' });
    expect(handle.className).toContain('right-0');
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 5 });
    fireEvent.pointerMove(window, { clientX: 140, pointerId: 5 });
    expect(widths()[0]).toBe(460);
    resize(1000);
    fireEvent.pointerUp(window, { clientX: 140, pointerId: 5 });
    expect(widths()[0]).toBe(420);
    expect(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)).toBeNull();
  });

  it('resizes the inward edge of the right pinned column in pointer direction at UI zoom', () => {
    const { resize, widths } = showTable(); resize(1100);
    const header = screen.getByRole('columnheader', { name: '操作' });
    const handle = screen.getByRole('separator', { name: '调整“操作”列宽' });
    Object.defineProperty(header, 'clientWidth', { configurable: true, value: 288 });
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ width: 432 } as DOMRect);
    fireEvent.pointerDown(handle, { button: 0, clientX: 600, pointerId: 9 });
    fireEvent.pointerMove(window, { clientX: 525, pointerId: 9 });
    expect(widths()[widths().length - 1]).toBe(338);
    expect(widths()[0]).toBe(420);
    fireEvent.pointerUp(window, { clientX: 525, pointerId: 9 });
    expect(handle.className).toContain('left-0');
  });

  it('keeps actions on one line and lets the column shrink without losing controls', () => {
    const { resize, widths } = showTable({ onRead: vi.fn() });
    resize(1100);
    expect(widths()[widths().length - 1]).toBe(288);
    const actions = screen.getByRole('group', { name: '条目操作：A long paper title' });
    expect(actions.className).not.toContain('overflow-x-auto');
    expect(actions.firstElementChild?.className).toContain('flex-nowrap');
    const handle = screen.getByRole('separator', { name: '调整“操作”列宽' });
    for (let step = 0; step < 40; step++) fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(widths()[widths().length - 1]).toBe(64);
    expect(JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)!).actions).toBe(64);
    expect(screen.queryByRole('button', { name: '开始阅读' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '更多操作：A long paper title' }));
    expect(screen.getByRole('button', { name: '开始阅读' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看详情' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '重新解析' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '移到回收站' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.doubleClick(handle);
    expect(widths()[widths().length - 1]).toBe(288);
  });

  it('preserves saved action widths within the compact icon column limits', () => {
    window.localStorage.setItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify({ title: 300, actions: 136 }));
    const { resize, widths } = showTable();
    resize(1100);
    expect(widths()[0]).toBe(300);
    const currentWidths = widths();
    expect(currentWidths[currentWidths.length - 1]).toBe(136);
    expect(JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)!)).toEqual({ title: 300, actions: 136 });
  });

  it('fits the selection column without changing saved widths and offsets the pinned title', () => {
    const { table, resize, widths, rerender } = showTable();
    const viewport = widths().reduce((sum, width) => sum + width, 0) * 2;
    resize(viewport);
    rerender({ selection: { enabled: true, ids: new Set(), all: false, some: false, toggle: vi.fn(), toggleAll: vi.fn() } });
    expect(widths()[0]).toBe(42);
    expect(widths().reduce((sum, width) => sum + width, 0)).toBeCloseTo(viewport);
    expect(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)).toBeNull();
    resize(1100);
    expect(screen.getByRole('columnheader', { name: '标题' }).style.left).toBe('42px');
    expect(table.querySelector('tbody td[data-pinned="left"]')).toBeTruthy();
  });
  it('fills a wide viewport proportionally beyond manual limits without persisting the expansion', () => {
    const { table, resize, widths } = showTable();
    const originalWidths = widths();
    resize(originalWidths.reduce((sum, width) => sum + width, 0) * 2);
    expect(widths()).toEqual(originalWidths.map(width => width * 2));
    expect(table.querySelectorAll('[data-pinned]')).toHaveLength(0);
    expect(table.querySelectorAll('col')).toHaveLength(ENTRY_LIBRARY_COLUMNS.length);
    expect(screen.getAllByRole('cell')).toHaveLength(ENTRY_LIBRARY_COLUMNS.length);
    expect(table.querySelector('thead th')?.className).not.toContain('shadow-[');
    expect(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)).toBeNull();
    resize(1100);
    expect(widths()).toEqual(originalWidths);
    expect(screen.getByRole('table')).toBe(table);
    expect(table.querySelectorAll('[data-pinned="left"]')).toHaveLength(2);
    expect(table.querySelectorAll('[data-pinned="right"]')).toHaveLength(2);
  });

  it('uses the scroll viewport excluding its gutter and switches pinning at the fit boundary', () => {
    const { table, resize, widths } = showTable();
    const baseWidth = widths().reduce((sum, width) => sum + width, 0);
    Object.defineProperty(table.closest('.entry-library-table-shell'), 'clientWidth', { configurable: true, value: baseWidth + 15 });
    resize(baseWidth - 15);
    expect(table.querySelectorAll('[data-pinned]')).toHaveLength(4);
    resize(baseWidth);
    expect(table.querySelectorAll('[data-pinned]')).toHaveLength(0);
    resize(baseWidth - 1);
    expect(table.querySelectorAll('[data-pinned]')).toHaveLength(4);
  });

  it('distributes space across visible columns, including a single column and empty states', () => {
    const { table, resize, widths, rerender } = showTable({ visibleColumns: new Set(['title', 'tags']) });
    resize(1830);
    expect(widths()).toEqual([1260, 570]);
    rerender({ visibleColumns: new Set(['tags']), entries: [], status: 'loading' });
    expect(widths()).toEqual([1830]);
    expect(table.querySelectorAll('[data-pinned]')).toHaveLength(0);
    expect(screen.getByText('正在打开条目库...').getAttribute('colspan')).toBe('1');
  });

  it('resizes expanded columns with the pointer at 150% zoom and preserves cancel and keyboard behavior', () => {
    const { resize, widths } = showTable();
    const viewport = widths().reduce((sum, width) => sum + width, 0) * 2;
    resize(viewport);
    const header = screen.getByRole('columnheader', { name: '标题' });
    const handle = screen.getByRole('separator', { name: '调整“标题”列宽' });
    Object.defineProperty(header, 'clientWidth', { configurable: true, value: 840 });
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ width: 1260 } as DOMRect);
    const drag = (pointerId: number) => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId });
      fireEvent.pointerMove(window, { clientX: 250, pointerId });
      expect(Math.abs(widths()[0] - 940)).toBeLessThan(1);
      expect(widths().reduce((sum, width) => sum + width, 0)).toBeCloseTo(viewport);
    };
    drag(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(widths()[0]).toBe(840);
    expect(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)).toBeNull();
    drag(2);
    fireEvent.pointerUp(window, { clientX: 250, pointerId: 2 });
    expect(JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)!)).toEqual({ title: 486 });
    const displayed = widths()[0];
    Object.defineProperty(header, 'clientWidth', { configurable: true, value: displayed });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(Math.abs(widths()[0] - displayed - 8)).toBeLessThan(1);
    fireEvent.doubleClick(handle);
    expect(widths()[0]).toBe(840);
  });
});

it('aligns resize feedback with each pinned column divider instead of the hit-area center', () => {
  const { resize } = showTable(); resize(1100);
  const left = screen.getByRole('separator', { name: '调整“标题”列宽' });
  const right = screen.getByRole('separator', { name: '调整“操作”列宽' });
  expect(left.className).toContain('after:right-0');
  expect(right.className).toContain('after:left-0');
  expect(left.className).not.toContain('after:left-1/2');
  expect(right.className).not.toContain('after:-translate-x-1/2');
});

it('uses the complete header border box when starting a pinned drag', () => {
  const { resize, widths } = showTable(); resize(1100);
  const header = screen.getByRole('columnheader', { name: '标题' });
  Object.defineProperty(header, 'clientWidth', { configurable: true, value: 419 });
  Object.defineProperty(header, 'offsetWidth', { configurable: true, value: 420 });
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ width: 630 } as DOMRect);
  const handle = screen.getByRole('separator', { name: '调整“标题”列宽' });
  fireEvent.pointerDown(handle, { button: 0, clientX: 600, pointerId: 77 });
  fireEvent.pointerMove(window, { clientX: 690, pointerId: 77 });
  fireEvent.pointerUp(window, { clientX: 690, pointerId: 77 });
  expect(widths()[0]).toBe(480);
});

it('keeps the fixed action cell opaque while its more menu is open', () => {
  window.localStorage.setItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify({ actions: 64 }));
  const { table, resize } = showTable(); resize(1100);
  fireEvent.click(screen.getByRole('button', { name: '更多操作：A long paper title' }));
  const row = table.querySelector('tbody tr')!;
  expect(row.className).toContain('has-aria-expanded:bg-muted');
  expect(row.className).not.toContain('has-aria-expanded:bg-muted/50');
  expect(row.querySelector('td[data-pinned="right"]')?.className).toContain('bg-inherit');
});


it('renders selected custom attributes as columns without mixing them with tags', () => {
  const id = fieldColumnId('CCF 等级');
  showTable({ visibleColumns: new Set(['title', id, 'actions']), entries: [{ id: 'paper', title: '论文', contents: [], tags: [], tagIds: [], fields: { 'CCF 等级': 'A' }, createdAt: '', updatedAt: '', pdfFileName: null, parseEndpoint: null, parseMessage: null, status: 'No PDF', progress: 0 }] });
  expect(screen.getByRole('columnheader', { name: 'CCF 等级' })).toBeTruthy();
  expect(screen.getByText('A')).toBeTruthy();
  expect(screen.queryByRole('columnheader', { name: '标签' })).toBeNull();
});


it('formats multi-select attributes and hides columns unavailable in the current library', () => {
  const id = fieldColumnId('收录');
  const missing = fieldColumnId('其他资料库字段');
  showTable({ visibleColumns: new Set(['title', id, missing]), fieldNames: ['收录'], fieldDefinitions: [{name: '收录', kind: 'multi_select', options: ['SCI', 'EI'], hidden: false}], entries: [{ id: 'paper', title: '论文', contents: [], tags: [], tagIds: [], fields: { '收录': '["SCI","EI"]' }, createdAt: '', updatedAt: '', pdfFileName: null, parseEndpoint: null, parseMessage: null, status: 'No PDF', progress: 0 }] });
  expect(screen.getByText('SCI、EI')).toBeTruthy();
  expect(screen.queryByRole('columnheader', { name: '其他资料库字段' })).toBeNull();
});


it('does not expose another workspace attribute column preference with the same name', () => {
  const id = fieldColumnId('CCF', 'D:/first');
  showTable({ workspaceRoot: 'D:/second', visibleColumns: new Set(['title', id]), fieldNames: ['CCF'] });
  expect(screen.queryByRole('columnheader', {name: 'CCF'})).toBeNull();
  expect(fieldColumnId('CCF', 'D:/second')).not.toBe(id);
});

describe('library column order', () => {
  it('uses the saved order without adding drag controls to headers', () => {
    window.localStorage.setItem('neuink.entryLibraryColumnOrder.v1:library-a', JSON.stringify(['tags', 'source', 'file']));
    const { table, resize } = showTable({ visibleColumns: new Set(['title', 'source', 'tags', 'file', 'actions']), workspaceRoot: 'library-a' });
    resize(900);
    expect(screen.getAllByRole('columnheader').map(cell => cell.getAttribute('aria-label'))).toEqual(['标题', '标签', '来源', '文件', '操作']);
    expect(table.querySelector('[draggable="true"]')).toBeNull();
    expect(screen.getByRole('columnheader', { name: '标题' }).dataset.pinned).toBe('left');
    expect(screen.getByRole('columnheader', { name: '操作' }).dataset.pinned).toBe('right');
  });
});


it('opens an editable property without opening the entry and saves the selected value', async () => {
  const onEditField = vi.fn().mockResolvedValue(undefined);
  const onOpen = vi.fn();
  const definition = { name: 'CCF 等级', kind: 'select' as const, options: ['A', 'B', 'C'], hidden: false };
  showTable({ workspaceRoot: 'root', visibleColumns: new Set(['title', fieldColumnId(definition.name, 'root'), 'actions']),
    fieldNames: [definition.name], fieldDefinitions: [definition], onEditField, onOpen });
  fireEvent.click(screen.getByRole('button', { name: '编辑A long paper title的CCF 等级' }));
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
  expect(screen.getByRole('button', { name: '留空' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'A' }));
  await waitFor(() => expect(onEditField).toHaveBeenCalledWith(expect.objectContaining({ id: 'paper' }), definition, null, 'A'));
  expect(onOpen).not.toHaveBeenCalled();
});


it('keeps the editor open and displays a save conflict', async () => {
  const onEditField = vi.fn().mockRejectedValue('该属性已在其他位置修改，请关闭编辑并重新打开');
  const definition = { name: '评价来源', kind: 'text' as const, options: [], hidden: false };
  showTable({ workspaceRoot: 'root', visibleColumns: new Set(['title', fieldColumnId(definition.name, 'root'), 'actions']),
    fieldNames: [definition.name], fieldDefinitions: [definition], onEditField });
  fireEvent.click(screen.getByRole('button', { name: '编辑A long paper title的评价来源' }));
  fireEvent.change(screen.getByPlaceholderText('属性值'), { target: { value: '来源' } });
  fireEvent.keyDown(screen.getByPlaceholderText('属性值'), { key: 'Enter' });
  expect((await screen.findByRole('alert')).textContent).toContain('其他位置修改');
  expect((screen.getByPlaceholderText('属性值') as HTMLInputElement).value).toBe('来源');
});

it('clears a choice immediately when selecting 留空', async () => {
  const onEditField = vi.fn().mockResolvedValue(undefined);
  const definition = { name: 'CCF 等级', kind: 'select' as const, options: ['A', 'B'], hidden: false };
  const paper = { id: 'paper', title: 'Paper', contents: [], tags: [], tagIds: [], fields: { 'CCF 等级': 'A' }, createdAt: '', updatedAt: '', pdfFileName: null, parseEndpoint: null, parseMessage: null, status: 'Parsed' as const, progress: 100 };
  showTable({ entries: [paper], workspaceRoot: 'root', visibleColumns: new Set(['title', fieldColumnId(definition.name, 'root'), 'actions']), fieldNames: [definition.name], fieldDefinitions: [definition], onEditField });
  fireEvent.click(screen.getByRole('button', { name: '编辑Paper的CCF 等级' }));
  fireEvent.click(screen.getByRole('button', { name: '留空' }));
  await waitFor(() => expect(onEditField).toHaveBeenCalledWith(expect.objectContaining({ id: 'paper' }), definition, 'A', null));
});


it('saves a multi-select change immediately without a save button', async () => {
  const onEditField = vi.fn().mockResolvedValue(undefined);
  const definition = { name: '收录情况', kind: 'multi_select' as const, options: ['SCI', 'EI'], hidden: false };
  showTable({ workspaceRoot: 'root', visibleColumns: new Set(['title', fieldColumnId(definition.name, 'root'), 'actions']), fieldNames: [definition.name], fieldDefinitions: [definition], onEditField });
  fireEvent.click(screen.getByRole('button', { name: '编辑A long paper title的收录情况' }));
  expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'SCI' }));
  await waitFor(() => expect(onEditField).toHaveBeenCalledWith(expect.objectContaining({ id: 'paper' }), definition, null, '["SCI"]'));
});

it('saves typed values when leaving the editor', async () => {
  const onEditField = vi.fn().mockResolvedValue(undefined);
  const definition = { name: '评价来源', kind: 'text' as const, options: [], hidden: false };
  showTable({ workspaceRoot: 'root', visibleColumns: new Set(['title', fieldColumnId(definition.name, 'root'), 'actions']), fieldNames: [definition.name], fieldDefinitions: [definition], onEditField });
  fireEvent.click(screen.getByRole('button', { name: '编辑A long paper title的评价来源' }));
  fireEvent.change(screen.getByPlaceholderText('属性值'), { target: { value: '人工核对' } });
  fireEvent.blur(screen.getByPlaceholderText('属性值'), { relatedTarget: document.body });
  await waitFor(() => expect(onEditField).toHaveBeenCalledWith(expect.objectContaining({ id: 'paper' }), definition, null, '人工核对'));
});


it('discards an unsaved text edit on Escape', async () => {
  const onEditField = vi.fn().mockResolvedValue(undefined);
  const definition = { name: '评价来源', kind: 'text' as const, options: [], hidden: false };
  showTable({ workspaceRoot: 'root', visibleColumns: new Set(['title', fieldColumnId(definition.name, 'root'), 'actions']), fieldNames: [definition.name], fieldDefinitions: [definition], onEditField });
  fireEvent.click(screen.getByRole('button', { name: '编辑A long paper title的评价来源' }));
  fireEvent.change(screen.getByPlaceholderText('属性值'), { target: { value: '不保存' } });
  fireEvent.keyDown(screen.getByPlaceholderText('属性值'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByPlaceholderText('属性值')).toBeNull());
  expect(onEditField).not.toHaveBeenCalled();
});
