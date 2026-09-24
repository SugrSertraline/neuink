// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ENTRY_LIBRARY_COLUMNS, LibraryPaperTable } from './LibraryPaperTable';
import { ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY } from './useEntryLibraryColumnWidths';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; }
}
beforeEach(() => { window.localStorage.clear(); vi.stubGlobal('PointerEvent', TestPointerEvent); });
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
  it('fills a wide viewport proportionally beyond manual limits without persisting the expansion', () => {
    const { table, resize, widths } = showTable();
    const originalWidths = widths();
    resize(3000);
    expect(widths()).toEqual(originalWidths.map(width => width * 2));
    expect(table.querySelectorAll('[data-pinned]')).toHaveLength(0);
    expect(table.querySelectorAll('col')).toHaveLength(9);
    expect(screen.getAllByRole('cell')).toHaveLength(9);
    expect(table.querySelector('thead th')?.className).not.toContain('shadow-[');
    expect(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)).toBeNull();
    resize(1100);
    expect(widths()).toEqual(originalWidths);
    expect(screen.getByRole('table')).toBe(table);
    expect(table.querySelectorAll('[data-pinned="left"]')).toHaveLength(2);
    expect(table.querySelectorAll('[data-pinned="right"]')).toHaveLength(2);
  });

  it('uses the scroll viewport excluding its gutter and switches pinning at the fit boundary', () => {
    const { table, resize } = showTable();
    Object.defineProperty(table.closest('.entry-library-table-shell'), 'clientWidth', { configurable: true, value: 1515 });
    resize(1485);
    expect(table.querySelectorAll('[data-pinned]')).toHaveLength(4);
    resize(1500);
    expect(table.querySelectorAll('[data-pinned]')).toHaveLength(0);
    resize(1499);
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
    resize(3000);
    const header = screen.getByRole('columnheader', { name: '标题' });
    const handle = screen.getByRole('separator', { name: '调整“标题”列宽' });
    Object.defineProperty(header, 'clientWidth', { configurable: true, value: 840 });
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ width: 1260 } as DOMRect);
    const drag = (pointerId: number) => {
      fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId });
      fireEvent.pointerMove(window, { clientX: 250, pointerId });
      expect(Math.abs(widths()[0] - 940)).toBeLessThan(1);
      expect(widths().reduce((sum, width) => sum + width, 0)).toBeCloseTo(3000);
    };
    drag(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(widths()[0]).toBe(840);
    expect(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)).toBeNull();
    drag(2);
    fireEvent.pointerUp(window, { clientX: 250, pointerId: 2 });
    expect(JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)!)).toEqual({ title: 493 });
    const displayed = widths()[0];
    Object.defineProperty(header, 'clientWidth', { configurable: true, value: displayed });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(Math.abs(widths()[0] - displayed - 8)).toBeLessThan(1);
    fireEvent.doubleClick(handle);
    expect(widths()[0]).toBe(840);
  });
});
