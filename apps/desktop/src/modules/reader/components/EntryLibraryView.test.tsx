// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ToastContext } from '@/shared/hooks/useToast';
import { AppearanceProvider, APP_APPEARANCE_STORAGE_KEY } from '@/shared/components/AppearanceProvider';

import type { LibraryEntry } from '../../library/components/LibrarySidebar';
import { ENTRY_LIBRARY_PINNED_EDGES_STORAGE_KEY, EntryLibraryView } from './EntryLibraryView';
import { ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY } from './useEntryLibraryColumnWidths';

const entry: LibraryEntry = {
  id: 'entry-1',
  contents: [],
  title: '可视分析论文',
  tagIds: ['hci'],
  tags: ['研究/HCI'],
  fields: { description: '测试条目' },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
  pdfFileName: 'paper.pdf',
  parseMessage: null,
  parseEndpoint: null,
  status: 'Parsed',
  progress: 100
};

class TestPointerEvent extends MouseEvent {
  pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLibrary(overrides: Partial<ComponentProps<typeof EntryLibraryView>> = {}) {
  const props: ComponentProps<typeof EntryLibraryView> = {
    standalone: true,
    activeTag: null,
    entries: [entry],
    filterResetKey: 0,
    isRefreshingParseStatus: false,
    libraryView: 'all',
    recentReadingEntryIds: [],
    selectedEntryId: null,
    status: 'ready',
    tags: [],
    trashItems: [],
    trashedEntries: [],
    workspaceRoot: null,
    onDeleteEntry: vi.fn(),
    onOpenCreateEntryTab: vi.fn(),
    onOpenEntryExplorer: vi.fn(),
    onOpenEntryInSidePane: vi.fn(),
    onPurgeEntry: vi.fn(),
    onPurgeTrashItem: vi.fn(),
    onRefreshParseStatus: vi.fn(),
    onReparseEntry: vi.fn(),
    onRestoreEntry: vi.fn(),
    onRestoreTrashItem: vi.fn(),
    onSelectEntry: vi.fn(),
    onSelectTag: vi.fn(),
    onUpdateTagDescription: vi.fn(),
    onOpenTagNote: vi.fn(),
    onUpdateEntry: vi.fn(),
    ...overrides
  };
  const result = render(<EntryLibraryView {...props} />, {
    wrapper: ({ children }) => <AppearanceProvider><TooltipProvider><ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast') }}>{children}</ToastContext.Provider></TooltipProvider></AppearanceProvider>
  });
  return { ...result, props, rerenderLibrary: (patch: Partial<typeof props>) => result.rerender(<EntryLibraryView {...props} {...patch} />) };
}

const libraryTags = [
  { id: 'research', name: '研究', parent_id: null, created_at: '', updated_at: '' },
  { id: 'hci', name: 'HCI', parent_id: 'research', created_at: '', updated_at: '' }
];

it('opens the independent relations page from the library header without selecting a paper', () => {
  const onOpenRelations = vi.fn(); const { props } = renderLibrary({ onOpenRelations });
  fireEvent.click(screen.getByRole('button', { name: '关系图' }));
  expect(onOpenRelations).toHaveBeenCalledOnce(); expect(props.onSelectEntry).not.toHaveBeenCalled();
});

it('distinguishes default row opening from the explicit details command', () => {
  const { props } = renderLibrary();
  const row = screen.getByRole('row', { name: /可视分析论文/ });
  fireEvent.click(row);
  expect(props.onOpenEntryExplorer).toHaveBeenLastCalledWith(entry.id);
  fireEvent.keyDown(row, { key: 'Enter' });
  expect(props.onOpenEntryExplorer).toHaveBeenLastCalledWith(entry.id);
  fireEvent.contextMenu(row);
  fireEvent.click(screen.getByRole('menuitem', { name: '查看详情' }));
  expect(props.onOpenEntryExplorer).toHaveBeenLastCalledWith(entry.id, 'overview');
});

describe('the optional bookshelf uses the existing library contract', () => {
  beforeEach(() => {
    window.localStorage.setItem(APP_APPEARANCE_STORAGE_KEY, 'atelier');
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  });
  it('keeps the same table node, filter, columns and scroll when switching displays', () => {
    const { container } = renderLibrary();
    const table = container.querySelector('[data-slot="table"]');
    const scroll = container.querySelector('[data-slot="table-container"]')!;
    scroll.scrollTop = 96;
    fireEvent.change(screen.getByRole('textbox', { name: '搜索条目' }), { target: { value: '可视分析' } });
    expect(within(screen.getByRole('region', { name: '论文书架' })).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('radio', { name: '列表' }));
    expect(screen.getByRole('table', { name: '论文列表' })).toBe(table);
    expect(scroll.scrollTop).toBe(96);
    expect((screen.getByRole('textbox', { name: '搜索条目' }) as HTMLInputElement).value).toBe('可视分析');
    fireEvent.click(screen.getByRole('radio', { name: '书架' }));
    expect(container.querySelector('[data-slot="table"]')).toBe(table);
    expect(window.localStorage.getItem('neuink.entryLibraryColumns.v1')).toBeNull();
  });
  it('opens details on click or Enter, and keeps split opening from bubbling', () => {
    const { props } = renderLibrary();
    const book = screen.getByRole('listitem', { name: entry.title });
    fireEvent.click(book);
    fireEvent.keyDown(book, { key: 'Enter' });
    expect(props.onOpenEntryExplorer).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: `在右侧打开 ${entry.title}` }));
    expect(props.onOpenEntryInSidePane).toHaveBeenCalledExactlyOnceWith(entry.id);
    expect(props.onOpenEntryExplorer).toHaveBeenCalledTimes(2);
  });
  it('uses the same tag scope and empty/error/loading states', () => {
    const { rerenderLibrary } = renderLibrary({ activeTag: 'research', tags: libraryTags });
    fireEvent.click(screen.getByRole('radio', { name: '仅当前标签' }));
    expect(screen.queryByRole('listitem', { name: entry.title })).toBeNull();
    expect(within(screen.getByRole('region', { name: '论文书架' })).getByRole('status').textContent).toContain('直接归入当前标签');
    fireEvent.click(screen.getByRole('radio', { name: '含子标签' }));
    expect(screen.getByRole('listitem', { name: entry.title })).toBeTruthy();
    rerenderLibrary({ status: 'loading' });
    expect(within(screen.getByRole('region', { name: '论文书架' })).getByRole('status').textContent).toContain('正在打开');
    rerenderLibrary({ status: 'error' });
    expect(within(screen.getByRole('region', { name: '论文书架' })).getByRole('alert').textContent).toContain('无法加载');
  });
  it('suppresses opening after a bookshelf drag and clears it when changing displays', () => {
    const { props } = renderLibrary();
    const book = screen.getByRole('listitem', { name: entry.title });
    Object.assign(book, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn() });
    fireEvent.pointerDown(book, { button: 0, clientX: 10, clientY: 10, pointerId: 7 });
    fireEvent.pointerMove(book, { clientX: 100, clientY: 100, pointerId: 7 });
    expect(document.body.style.cursor).toBe('grabbing');
    fireEvent.click(screen.getByRole('radio', { name: '列表' }));
    expect(document.body.style.cursor).toBe('');
    expect(props.onOpenEntryExplorer).not.toHaveBeenCalled();
  });
});

describe('EntryLibraryView context heading and toolbar', () => {
  it('keeps tag description drafts, paper scope and search when switching content and navigation visibility', () => {
    renderLibrary({ activeTag: 'research', tags: libraryTags });
    fireEvent.click(screen.getByRole('button', { name: '添加标签描述' }));
    fireEvent.change(screen.getByRole('textbox', { name: '标签描述' }), { target: { value: '尚未保存的研究主题' } });
    fireEvent.change(screen.getByRole('textbox', { name: '搜索条目' }), { target: { value: '可视分析' } });
    fireEvent.click(screen.getByRole('radio', { name: '仅当前标签' }));
    fireEvent.click(screen.getByRole('button', { name: '标签导航' }));
    expect(screen.queryByText(entry.title)).toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: '标签笔记' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('textbox', { name: '搜索标签笔记' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '标签导航' })).toBeNull();
    expect(screen.queryByRole('button', { name: '创建条目' })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('tab', { name: '论文' }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('button', { name: '标签导航' }));
    expect(screen.getByRole('radio', { name: '仅当前标签' }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByRole('textbox', { name: '搜索条目' }) as HTMLInputElement).value).toBe('可视分析');
    expect((screen.getByRole('textbox', { name: '标签描述' }) as HTMLTextAreaElement).value).toBe('尚未保存的研究主题');
    expect(screen.queryByText(entry.title)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '含子标签' }));
    expect(screen.getByText(entry.title)).toBeTruthy();
  });

  it('keeps statistics mounted beside the tabs, with creation in the same header slot', () => {
    const { props } = renderLibrary({ activeTag: 'research', tags: libraryTags });
    const header = screen.getByLabelText('条目库页眉');
    const actions = within(header).getByLabelText('条目库操作');
    const statistics = within(actions).getByRole('button', { name: '阅读统计' });
    expect(within(header).queryByRole('button', { name: '平行阅读' })).toBeNull();
    expect(within(header).queryByRole('button', { name: '标签操作' })).toBeNull();
    expect(within(actions).getByRole('tablist', { name: '标签内容' })).toBeTruthy();
    fireEvent.mouseDown(within(actions).getByRole('tab', { name: '标签笔记' }), { button: 0, ctrlKey: false });
    expect(within(actions).getByRole('button', { name: '阅读统计' })).toBe(statistics);
    expect(within(header).queryByRole('button', { name: '平行阅读' })).toBeNull();
    expect(within(actions).getByRole('button', { name: '新建笔记' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '新建笔记' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '刷新' })).toBeNull();
    const search = screen.getByRole('textbox', { name: '搜索标签笔记' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: '保留笔记搜索' } });
    fireEvent.mouseDown(within(actions).getByRole('tab', { name: '论文' }), { button: 0, ctrlKey: false });
    fireEvent.click(within(actions).getByRole('button', { name: '创建条目' }));
    expect(props.onOpenCreateEntryTab).toHaveBeenCalledOnce();
    fireEvent.mouseDown(within(actions).getByRole('tab', { name: '标签笔记' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('textbox', { name: '搜索标签笔记' })).toBe(search);
    expect(search.value).toBe('保留笔记搜索');
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(search.value).toBe('');
  });

  it.each([
    ['all', '全部条目'], ['recent', '最近阅读'], ['parsed', '已解析 PDF'],
    ['parsing', '解析中'], ['failed', '解析失败'], ['no_pdf', '无 PDF'], ['trash', '回收站']
  ] as const)('names the %s view consistently with its navigation', (libraryView, title) => {
    renderLibrary({ libraryView });
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '条目库' })).toBeNull();
  });

  it('shows the tag name, full path and count without extra tag actions', () => {
    renderLibrary({ activeTag: 'hci', tags: libraryTags });
    expect(screen.getByRole('heading', { level: 1, name: 'HCI' }).title).toBe('HCI');
    const header = screen.getByLabelText('条目库页眉');
    expect(within(header).getByText('1 个条目 · 含子标签').title).toBe('1 个条目 · 含子标签');
    const toolbar = screen.getByLabelText('条目库筛选与操作');
    expect(within(toolbar).queryByText(/标签：/)).toBeNull();
    expect(within(header).queryByRole('button', { name: '平行阅读' })).toBeNull();
    expect(within(header).queryByRole('button', { name: '标签操作' })).toBeNull();
    expect(within(toolbar).getByRole('button', { name: '清除搜索' }).dataset.size).toBe('icon-sm');
    expect(within(toolbar).getByRole('combobox', { name: '条目排序' }).dataset.size).toBe('default');
  });

  it('keeps the view filter visible alongside the tag and updates search counts', () => {
    renderLibrary({ libraryView: 'parsed', activeTag: 'research', tags: libraryTags });
    const header = screen.getByLabelText('条目库页眉');
    expect(header.textContent).toContain('已解析 PDF · 1 个条目 · 含子标签');
    fireEvent.change(screen.getByRole('textbox', { name: '搜索条目' }), { target: { value: '无匹配内容' } });
    expect(header.textContent).toContain('搜索结果：0 个条目');
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(header.textContent).toContain('已解析 PDF · 1 个条目');
  });

  it('defaults tag browsing to descendants and keeps direct scope consistent during search', () => {
    window.localStorage.setItem('neuink.entryLibraryLayout', 'tag-folders');
    renderLibrary({ activeTag: 'research', tags: libraryTags });
    const header = screen.getByLabelText('条目库页眉');
    expect(header.textContent).toContain('1 个条目 · 含子标签');
    expect(screen.getByText(entry.title)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: '仅当前标签' }));
    expect(window.localStorage.getItem('neuink.entryLibraryTagScope')).toBe('direct');
    expect(header.textContent).toContain('0 个条目 · 仅当前标签');
    expect(screen.queryByText(entry.title)).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: '搜索条目' }), { target: { value: '可视分析' } });
    expect(header.textContent).toContain('搜索结果：0 个条目 · 仅当前标签');

    fireEvent.click(screen.getByRole('radio', { name: '含子标签' }));
    expect(header.textContent).toContain('搜索结果：1 个条目 · 含子标签');
    expect(screen.getByText(entry.title)).toBeTruthy();
  });

  it('keeps reading statistics behind one compact control', async () => {
    renderLibrary();
    expect(screen.queryByText('今日阅读')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '阅读统计' }));
    expect(await screen.findByLabelText('阅读统计详情')).toBeTruthy();
    expect(screen.getByText('今日阅读')).toBeTruthy();
    expect(screen.getByText('累计阅读')).toBeTruthy();
  });

  it('opens an ancestor from the compact path menu without changing navigation visibility', () => {
    const { props } = renderLibrary({ activeTag: 'hci', tags: libraryTags });
    fireEvent.keyDown(screen.getByRole('button', { name: '上级标签' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: '研究' }));
    expect(props.onSelectTag).toHaveBeenCalledExactlyOnceWith('research');
    expect(screen.getByRole('button', { name: '标签导航' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reacts to renaming or clearing the active tag without retaining stale heading text', () => {
    const { rerenderLibrary } = renderLibrary({ activeTag: 'hci', tags: libraryTags });
    rerenderLibrary({ tags: libraryTags.map((tag) => tag.id === 'hci' ? { ...tag, name: '交互设计' } : tag) });
    expect(screen.getByRole('heading', { name: '交互设计' })).toBeTruthy();
    expect(screen.getByLabelText('条目库页眉').textContent).toContain('研究');
    rerenderLibrary({ activeTag: null, libraryView: 'recent' });
    expect(screen.getByRole('heading', { name: '最近阅读' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '平行阅读' })).toBeNull();
  });

  it.each(['loading', 'error'] as const)('shows %s instead of a misleading count', (status) => {
    renderLibrary({ activeTag: 'hci', tags: libraryTags, status });
    expect(screen.getByLabelText('条目库页眉').textContent).toContain(status === 'loading' ? '正在加载…' : '加载失败');
    expect(screen.getByLabelText('条目库页眉').textContent).not.toContain('个条目');
    expect(screen.queryByRole('button', { name: '平行阅读' })).toBeNull();
  });

  it('does not expose a missing tag id as the page title or offer an invalid reading action', () => {
    renderLibrary({ activeTag: 'missing-tag-id' });
    expect(screen.getByRole('heading', { name: '标签不可用' })).toBeTruthy();
    expect(screen.getByLabelText('条目库页眉').textContent).not.toContain('missing-tag-id');
    expect(screen.queryByRole('button', { name: '平行阅读' })).toBeNull();
  });

  it('does not imply that the global trash is filtered by a previously active tag', () => {
    renderLibrary({ libraryView: 'trash', activeTag: 'hci', tags: libraryTags });
    expect(screen.getByRole('heading', { name: '回收站' })).toBeTruthy();
    expect(screen.getByLabelText('条目库页眉').textContent).not.toContain('HCI');
    expect(screen.queryByRole('button', { name: '平行阅读' })).toBeNull();
  });
});

describe('EntryLibraryView pinned columns', () => {
  it('pins the first and last visible columns in both header and body', () => {
    renderLibrary({ selectedEntryId: entry.id });
    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader');
    const cells = within(table).getAllByRole('cell');
    expect(headers.map((cell) => cell.dataset.pinned)).toEqual(['left', ...Array(7).fill(undefined), 'right']);
    expect(cells.map((cell) => cell.dataset.pinned)).toEqual(['left', ...Array(7).fill(undefined), 'right']);
    expect(headers.every(cell => !cell.classList.contains('border-r'))).toBe(true);
    expect(cells.every(cell => !cell.classList.contains('border-r'))).toBe(true);
    expect(headers[0].className).toContain('sticky');
    expect(headers[0].className).not.toContain('relative');
    expect(headers[1].className).toContain('relative');
    expect(headers[0].className).toContain('text-left');
    expect(headers[0].className).toContain('shadow-[4px_0_12px_-6px_color-mix(in_oklab,var(--foreground)_12%,transparent)]');
    expect(headers[headers.length - 1].className).toContain('shadow-[-4px_0_12px_-6px_color-mix(in_oklab,var(--foreground)_12%,transparent)]');
    expect(cells[0].className).toContain('shadow-[4px_0_12px_-6px_color-mix(in_oklab,var(--foreground)_12%,transparent)]');
    expect(cells[cells.length - 1].className).toContain('shadow-[-4px_0_12px_-6px_color-mix(in_oklab,var(--foreground)_12%,transparent)]');
    expect(cells[0].parentElement?.dataset.state).toBe('selected');
    expect(cells[0].className).toContain('bg-inherit');
    expect(cells[cells.length - 1].className).toContain('bg-inherit');
    expect(table.className).toContain('border-separate');
    expect(table.parentElement?.dataset.slot).toBe('table-container');
    const title = screen.getByText(entry.title);
    expect(title.className).toContain('truncate');
    expect(title.getAttribute('title')).toBe(entry.title);
    expect(table.className).toContain('table-fixed');
    expect(table.className).not.toContain('w-max');
    expect(table.className).not.toContain('min-w-full');
    expect(table.style.width).toBe('max(100%, 1500px)');
    expect(table.style.minWidth).toBe('1500px');
    expect(table.style.maxWidth).toBe('none');
    expect(table.querySelectorAll('col')).toHaveLength(9);
    expect(table.querySelector('col')?.style.maxWidth).toBe('420px');
    expect(cells[0].className).toContain('overflow-hidden');
  });

  it('resizes a column from its header handle and restores the saved width after remounting', () => {
    const firstView = renderLibrary();
    const titleHeader = screen.getAllByRole('columnheader')[0];
    const handle = within(titleHeader).getByRole('separator', { name: '调整“标题”列宽' });
    Object.defineProperties(handle, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      setPointerCapture: { configurable: true, value: vi.fn() }
    });
    vi.spyOn(titleHeader, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect);

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 7 });
    fireEvent.pointerMove(handle, { clientX: 180, pointerId: 7 });
    expect(screen.getByRole('table').querySelector('col')?.style.width).toBe('500px');
    fireEvent.pointerUp(handle, { clientX: 180, pointerId: 7 });
    expect(JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY) ?? '{}')).toEqual({ title: 500 });

    firstView.unmount();
    renderLibrary();
    expect(screen.getByRole('table').querySelector('col')?.style.width).toBe('500px');
  });

  it('ignores sub-threshold movement and rolls an active resize back on Escape', () => {
    renderLibrary();
    const titleHeader = screen.getAllByRole('columnheader')[0];
    const handle = within(titleHeader).getByRole('separator', { name: '调整“标题”列宽' });
    Object.defineProperties(handle, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      setPointerCapture: { configurable: true, value: vi.fn() }
    });
    vi.spyOn(titleHeader, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect);

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 8 });
    fireEvent.pointerMove(handle, { clientX: 102, pointerId: 8 });
    fireEvent.pointerUp(handle, { clientX: 102, pointerId: 8 });
    expect(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)).toBeNull();

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 9 });
    fireEvent.pointerMove(handle, { clientX: 180, pointerId: 9 });
    expect(screen.getByRole('table').querySelector('col')?.style.width).toBe('500px');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('table').querySelector('col')?.style.width).toBe('420px');
    expect(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY)).toBeNull();
  });

  it('caps a resized title column to the visible table width while preserving the actions column', () => {
    renderLibrary();
    const table = screen.getByRole('table');
    const shell = table.closest('.entry-library-table-shell');
    expect(shell).toBeInstanceOf(HTMLElement);
    Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 560 });
    fireEvent(window, new Event('resize'));

    const titleHeader = screen.getAllByRole('columnheader')[0];
    const handle = within(titleHeader).getByRole('separator', { name: '调整“标题”列宽' });
    Object.defineProperties(handle, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      setPointerCapture: { configurable: true, value: vi.fn() }
    });
    vi.spyOn(titleHeader, 'getBoundingClientRect').mockReturnValue({ width: 420 } as DOMRect);

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 10 });
    fireEvent.pointerMove(window, { clientX: 900, pointerId: 10 });
    expect(table.querySelector('col')?.style.width).toBe('280px');
    fireEvent.pointerUp(window, { clientX: 900, pointerId: 10 });
    expect(JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY) ?? '{}')).toEqual({ title: 280 });
    expect(handle.getAttribute('aria-valuemax')).toBe('280');
  });

  it('keeps pointer movement proportional when the UI is zoomed', () => {
    renderLibrary();
    const titleHeader = screen.getAllByRole('columnheader')[0];
    const handle = within(titleHeader).getByRole('separator', { name: '调整“标题”列宽' });
    Object.defineProperties(handle, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      setPointerCapture: { configurable: true, value: vi.fn() }
    });
    Object.defineProperty(titleHeader, 'clientWidth', { configurable: true, value: 420 });
    vi.spyOn(titleHeader, 'getBoundingClientRect').mockReturnValue({ width: 630 } as DOMRect);

    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 11 });
    fireEvent.pointerMove(window, { clientX: 250, pointerId: 11 });
    expect(screen.getByRole('table').querySelector('col')?.style.width).toBe('520px');
    fireEvent.pointerUp(window, { clientX: 250, pointerId: 11 });
  });

  it('re-clamps every oversized saved column when the table viewport becomes narrower', () => {
    window.localStorage.setItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify({
      title: 900,
      tags: 600,
      'reading-progress': 470
    }));
    renderLibrary();
    const table = screen.getByRole('table');
    const shell = table.closest('.entry-library-table-shell');
    expect(shell).toBeInstanceOf(HTMLElement);
    Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 520 });
    fireEvent(window, new Event('resize'));

    expect(table.querySelector('col')?.style.width).toBe('260px');
    expect(JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY) ?? '{}')).toEqual({
      title: 260,
      tags: 260,
      'reading-progress': 260
    });
  });

  it('checks saved widths when hiding tag navigation', () => {
    window.localStorage.setItem('neuink.entryLibraryLayout', 'tag-folders');
    window.localStorage.setItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify({ title: 900 }));
    renderLibrary();
    const browsingTable = screen.getByRole('table', { name: '论文列表' });

    fireEvent.click(screen.getByRole('button', { name: '标签导航' }));
    const table = document.querySelector<HTMLTableElement>('[data-slot="table"]');
    expect(table).toBe(browsingTable);
    expect(table).toBeInstanceOf(HTMLTableElement);
    if (!table) throw new Error('Expected the entry table to open');
    const shell = table.closest('.entry-library-table-shell');
    expect(shell).toBeInstanceOf(HTMLElement);
    Object.defineProperty(shell, 'clientWidth', { configurable: true, value: 520 });
    fireEvent(window, new Event('resize'));

    expect(table.querySelector('col')?.style.width).toBe('260px');
    expect(JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY) ?? '{}')).toEqual({ title: 260 });
  });

  it.each([
    { columns: ['title', 'tags'], pins: ['left', 'right'] },
    { columns: ['tags', 'actions'], pins: ['left', 'right'] },
    { columns: ['tags'], pins: ['left'] },
    { columns: ['title', 'actions'], pins: ['left', 'right'] }
  ])('respects saved visible columns: $columns', ({ columns, pins }) => {
    window.localStorage.setItem('neuink.entryLibraryColumns.v1', JSON.stringify(columns));
    renderLibrary();
    expect(screen.getAllByRole('columnheader').map((cell) => cell.dataset.pinned)).toEqual(pins);
    expect(screen.getAllByRole('cell').map((cell) => cell.dataset.pinned)).toEqual(pins);
  });

  it('lets the user configure and persist the pinned left and right edges', () => {
    renderLibrary();
    const table = screen.getByRole('table');
    fireEvent.keyDown(screen.getByRole('button', { name: '表头' }), { key: 'Enter' });
    const pinLeft = screen.getByRole('menuitemcheckbox', { name: '固定最左列' });
    const pinRight = screen.getByRole('menuitemcheckbox', { name: '固定最右列' });
    expect(pinLeft.getAttribute('aria-checked')).toBe('true');
    expect(pinRight.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(pinLeft);
    let headers = within(table).getAllByRole('columnheader', { hidden: true });
    expect(headers[0].dataset.pinned).toBeUndefined();
    expect(headers[headers.length - 1].dataset.pinned).toBe('right');
    expect(JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_PINNED_EDGES_STORAGE_KEY) ?? '[]')).toEqual(['right']);

    fireEvent.click(pinRight);
    headers = within(table).getAllByRole('columnheader', { hidden: true });
    expect(headers.every((cell) => cell.dataset.pinned === undefined)).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(ENTRY_LIBRARY_PINNED_EDGES_STORAGE_KEY) ?? '[]')).toEqual([]);
  });

  it('keeps opening and action events separate, including keyboard activation', () => {
    const { props } = renderLibrary();
    const title = screen.getByText(entry.title);
    fireEvent.click(title);
    expect(props.onOpenEntryExplorer).toHaveBeenCalledTimes(1);
    const row = title.closest('tr')!;
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(props.onOpenEntryExplorer).toHaveBeenCalledTimes(3);
    const action = screen.getByRole('button', { name: '移到回收站' });
    fireEvent.keyDown(action, { key: 'Enter' });
    fireEvent.click(action);
    expect(props.onOpenEntryExplorer).toHaveBeenCalledTimes(3);
    expect(props.onDeleteEntry).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it.each([
    { status: 'loading' as const, text: '正在打开条目库...' },
    { status: 'ready' as const, text: '没有符合当前筛选条件的条目。' }
  ])('keeps the $status message spanning all visible columns without pinning it', ({ status, text }) => {
    renderLibrary({ entries: [], status });
    const message = screen.getByText(text);
    expect(message.getAttribute('colspan')).toBe('9');
    expect(message.dataset.pinned).toBeUndefined();
  });
});

describe('EntryLibraryView tag navigation visibility', () => {
  it.each([
    { legacy: 'table', current: null, shown: false },
    { legacy: 'tag-folders', current: null, shown: true },
    { legacy: 'table', current: 'true', shown: true },
    { legacy: 'tag-folders', current: 'false', shown: false },
    { legacy: 'tag-folders', current: 'invalid', shown: true }
  ])('restores navigation preference $current with legacy $legacy', ({ legacy, current, shown }) => {
    window.localStorage.setItem('neuink.entryLibraryLayout', legacy);
    if (current !== null) window.localStorage.setItem('neuink.entryLibraryShowTagNavigation', current);
    renderLibrary({ tags: libraryTags });
    const toolbar = screen.getByLabelText('条目库筛选与操作');
    expect(within(toolbar).getByRole('button', { name: '标签导航' }).getAttribute('aria-pressed')).toBe(String(shown));
    expect(Boolean(screen.queryByRole('navigation', { name: '标签导航' }))).toBe(shown);
    expect(within(screen.getByLabelText('条目库页眉')).queryByRole('button', { name: '标签导航' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: '条目库视图' })).toBeNull();
  });

  it('remembers visibility across tag navigation and reopening, including tags with no children', () => {
    const view = renderLibrary({ tags: libraryTags });
    const toggle = screen.getByRole('button', { name: '标签导航' });
    fireEvent.click(toggle);
    view.rerenderLibrary({ activeTag: 'research' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '打开标签 研究/HCI' })).toBeTruthy();
    view.rerenderLibrary({ activeTag: 'hci' });
    expect(screen.queryByRole('navigation', { name: '标签导航' })).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    view.unmount();
    const reopened = renderLibrary({ tags: libraryTags });
    expect(screen.getByRole('navigation', { name: '标签导航' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '标签导航' }));
    reopened.unmount();
    renderLibrary({ tags: libraryTags });
    expect(screen.getByRole('button', { name: '标签导航' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('navigation', { name: '标签导航' })).toBeNull();
  });

  it('keeps the same papers, selection, columns and scroller when toggling tag navigation', () => {
    const untagged = { ...entry, id: 'untagged', title: '未标记论文', tagIds: [], tags: [] };
    window.localStorage.setItem('neuink.entryLibraryColumns.v1', JSON.stringify(['title', 'tags', 'actions']));
    window.localStorage.setItem(ENTRY_LIBRARY_COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify({ title: 380 }));
    renderLibrary({ entries: [entry, untagged], tags: libraryTags, selectedEntryId: entry.id });
    const table = screen.getByRole('table', { name: '论文列表' });
    const scroll = table.parentElement!;
    scroll.scrollTop = 120;
    scroll.scrollLeft = 80;
    const columns = table.querySelector('colgroup')!.innerHTML;
    const rows = () => Array.from(table.querySelectorAll('[data-entry-id]')).map(row => row.getAttribute('data-entry-id'));
    expect(rows()).toEqual([entry.id, untagged.id]);
    fireEvent.click(screen.getByRole('button', { name: '标签导航' }));
    expect(screen.getByRole('table', { name: '论文列表' })).toBe(table);
    expect(table.parentElement).toBe(scroll);
    expect([scroll.scrollTop, scroll.scrollLeft]).toEqual([120, 80]);
    expect(table.querySelector('colgroup')!.innerHTML).toBe(columns);
    expect(rows()).toEqual([entry.id, untagged.id]);
    expect(table.querySelector('[data-state=selected]')?.getAttribute('data-entry-id')).toBe(entry.id);
    expect(screen.getByRole('button', { name: '表头' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '标签导航' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '标签导航' }));
    expect(screen.queryByRole('navigation', { name: '标签导航' })).toBeNull();
    expect(screen.getByRole('table')).toBe(table);
    expect(rows()).toEqual([entry.id, untagged.id]);
  });

  it('makes unclassified an explicit filter that survives navigation visibility/search and reacts to tag assignment', () => {
    const untagged = { ...entry, id: 'untagged', title: '未标记论文', tagIds: [], tags: [] };
    const { rerenderLibrary } = renderLibrary({ entries: [entry, untagged], tags: libraryTags });
    fireEvent.click(screen.getByRole('radio', { name: '未分类' }));
    expect(screen.queryByText(entry.title)).toBeNull();
    expect(screen.getByText(untagged.title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '标签导航' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索条目' }), { target: { value: '未标记' } });
    expect(screen.queryByText(entry.title)).toBeNull();
    expect(screen.getByText(untagged.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开标签 研究' }).title).toContain('1 篇论文');
    fireEvent.click(screen.getByRole('button', { name: '标签导航' }));
    expect(screen.getByRole('radio', { name: '未分类' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    rerenderLibrary({ entries: [entry, { ...untagged, tagIds: ['research'], tags: ['研究'] }] });
    expect(screen.queryByText(untagged.title)).toBeNull();
    expect(screen.getByText('当前范围内没有未分类论文。')).toBeTruthy();
  });

  it('does not let unclassified hide papers inside a tag or leak to another library view', () => {
    const { rerenderLibrary } = renderLibrary({ tags: libraryTags });
    fireEvent.click(screen.getByRole('radio', { name: '未分类' }));
    rerenderLibrary({ activeTag: 'research' });
    expect(screen.queryByRole('radio', { name: '未分类' })).toBeNull();
    expect(screen.getByText(entry.title)).toBeTruthy();
    rerenderLibrary({ activeTag: null });
    expect(screen.getByRole('radio', { name: '全部论文' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '未分类' }));
    rerenderLibrary({ libraryView: 'parsed' });
    expect(screen.getByText(entry.title)).toBeTruthy();
  });

  it('keeps tag navigation counts and empty tags available while searching papers', () => {
    window.localStorage.setItem('neuink.entryLibraryLayout', 'tag-folders');
    renderLibrary({ tags: [...libraryTags, { id: 'empty', name: '空标签', parent_id: null, created_at: '', updated_at: '' }] });
    const research = screen.getByRole('button', { name: '打开标签 研究' });
    fireEvent.change(screen.getByRole('textbox', { name: '搜索条目' }), { target: { value: '没有匹配' } });
    expect(research.title).toContain('1 篇论文');
    expect(screen.getByRole('button', { name: '打开标签 空标签' }).title).toContain('0 篇论文');
    expect(screen.queryByText(entry.title)).toBeNull();
  });

  it('preserves sorting and search while toggling navigation', () => {
    renderLibrary({ entries: [{ ...entry, title: 'Z 论文' }, { ...entry, id: 'another', title: 'A 论文' }], tags: libraryTags });
    fireEvent.change(screen.getByRole('textbox', { name: '搜索条目' }), { target: { value: '论文' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: '条目排序' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('option', { name: '标题' }), { key: 'Enter' });
    const order = () => Array.from(screen.getByRole('table').querySelectorAll('[data-entry-id]')).map(row => row.getAttribute('data-entry-id'));
    expect(order()).toEqual(['another', entry.id]);
    fireEvent.click(screen.getByRole('button', { name: '标签导航' }));
    expect(order()).toEqual(['another', entry.id]);
    expect((screen.getByRole('textbox', { name: '搜索条目' }) as HTMLInputElement).value).toBe('论文');
    expect(screen.getByRole('combobox', { name: '条目排序' }).textContent).toContain('标题');
  });

  it.each([
    { layout: 'table', status: 'loading' }, { layout: 'table', status: 'error' },
    { layout: 'tag-folders', status: 'loading' }, { layout: 'tag-folders', status: 'error' }
  ] as const)('hides stale entries and drop targets in $layout while $status', ({ layout, status }) => {
    window.localStorage.setItem('neuink.entryLibraryLayout', layout);
    renderLibrary({ activeTag: 'research', tags: libraryTags, status });
    expect(screen.queryByRole('button', { name: '打开标签 研究/HCI' })).toBeNull();
    expect(screen.queryByRole('button', { name: '浏览标签 研究/HCI' })).toBeNull();
    expect(screen.queryByText(entry.title)).toBeNull();
    expect((screen.getByRole('button', { name: '添加标签描述' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '标签导航' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(status === 'loading' ? '正在打开条目库...' : '无法加载标签和论文，请重新打开工作区后重试。')).toBeTruthy();
  });

  it('does not show unrelated root folders under an archived tag and offers a path back to all tags', () => {
    window.localStorage.setItem('neuink.entryLibraryLayout', 'tag-folders');
    const { props } = renderLibrary({ activeTag: 'removed', tags: libraryTags });
    expect(screen.queryByRole('button', { name: '打开标签 研究' })).toBeNull();
    expect(screen.queryByRole('button', { name: '查看标签详情' })).toBeNull();
    expect(screen.getByText('当前标签已移入回收站或不可用。返回全部条目或打开回收站继续。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回全部条目' }));
    expect(props.onSelectTag).toHaveBeenCalledWith(null);
  });

  it('shows immediate child navigation and shared tag details without duplicating a multi-tagged paper', () => {
    window.localStorage.setItem('neuink.entryLibraryLayout', 'tag-folders');
    const multiTaggedEntry = {
      ...entry,
      tagIds: ['visualization', 'methods'],
      tags: ['研究/HCI/可视化', '方法']
    };
    renderLibrary({
      activeTag: 'research',
      entries: [multiTaggedEntry],
      tags: [
        ...libraryTags,
        { id: 'visualization', name: '可视化', parent_id: 'hci', created_at: '', updated_at: '' },
        { id: 'methods', name: '方法', parent_id: null, created_at: '', updated_at: '' }
      ]
    });

    expect(screen.getAllByText(entry.title)).toHaveLength(1);
    expect(screen.getByRole('button', { name: '查看全部 2 个标签' }).getAttribute('aria-description')).toBe('研究/HCI/可视化；方法');
    const navigation = screen.getByRole('navigation', { name: '标签导航' });
    expect(within(navigation).getByRole('button', { name: '打开标签 研究/HCI' })).toBeTruthy();
    expect(within(navigation).queryByRole('button', { name: '打开标签 研究/HCI/可视化' })).toBeNull();
  });

  it('persists tag navigation visibility without replacing the paper table', () => {
    const onSelectTag = vi.fn();
    render(
      <TooltipProvider><ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast') }}>
        <EntryLibraryView
          standalone
          activeTag={null}
          entries={[entry]}
          filterResetKey={0}
          isRefreshingParseStatus={false}
          libraryView="all"
          recentReadingEntryIds={[]}
          selectedEntryId={null}
          status="ready"
          tags={[
            { id: 'research', name: '研究', parent_id: null, created_at: '', updated_at: '' },
            { id: 'hci', name: 'HCI', parent_id: 'research', created_at: '', updated_at: '' }
          ]}
          trashItems={[]}
          trashedEntries={[]}
          workspaceRoot={null}
          onDeleteEntry={vi.fn()}
          onOpenCreateEntryTab={vi.fn()}
          onOpenEntryExplorer={vi.fn()}
          onOpenEntryInSidePane={vi.fn()}
          onPurgeEntry={vi.fn()}
          onPurgeTrashItem={vi.fn()}
          onRefreshParseStatus={vi.fn()}
          onReparseEntry={vi.fn()}
          onRestoreEntry={vi.fn()}
          onRestoreTrashItem={vi.fn()}
          onSelectEntry={vi.fn()}
          onSelectTag={onSelectTag}
          onUpdateEntry={vi.fn()}
        />
      </ToastContext.Provider></TooltipProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '标签导航' }));

    expect(window.localStorage.getItem('neuink.entryLibraryShowTagNavigation')).toBe('true');
    expect(screen.getByRole('table', { name: '论文列表' })).toBeTruthy();
    expect(screen.getByText('研究')).toBeTruthy();
    expect(screen.getByLabelText('1 篇论文（含下级标签）')).toBeTruthy();
    expect(screen.queryByText('名称查看详情 · 浏览进入目录 · 拖入只添加标签')).toBeNull();
    expect(screen.getByText('可视分析论文')).toBeTruthy();
    expect(screen.getByRole('table', { name: '论文列表' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '标题' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '标签' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '更新时间' })).toBeTruthy();

    const folder = screen.getByRole('button', { name: '打开标签 研究' });
    expect(folder.getAttribute('title')).toBe('进入标签：研究；1 篇论文（含下级标签）');
    fireEvent.click(folder, { detail: 1 });
    expect(onSelectTag).toHaveBeenCalledExactlyOnceWith('research');
    fireEvent.click(folder, { detail: 0 });
    expect(onSelectTag).toHaveBeenCalledTimes(2);
  });

  it('restores persisted table column visibility choices', () => {
    window.localStorage.setItem(
      'neuink.entryLibraryColumns.v1',
      JSON.stringify(['title', 'reading-progress', 'last-read', 'reading-time', 'file', 'parser', 'updated', 'actions'])
    );
    render(
      <TooltipProvider><ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'toast') }}>
        <EntryLibraryView
          standalone
          activeTag={null}
          entries={[entry]}
          filterResetKey={0}
          isRefreshingParseStatus={false}
          libraryView="all"
          recentReadingEntryIds={[]}
          selectedEntryId={null}
          status="ready"
          tags={[]}
          trashItems={[]}
          trashedEntries={[]}
          workspaceRoot={null}
          onDeleteEntry={vi.fn()}
          onOpenCreateEntryTab={vi.fn()}
          onOpenEntryExplorer={vi.fn()}
          onOpenEntryInSidePane={vi.fn()}
          onPurgeEntry={vi.fn()}
          onPurgeTrashItem={vi.fn()}
          onRefreshParseStatus={vi.fn()}
          onReparseEntry={vi.fn()}
          onRestoreEntry={vi.fn()}
          onRestoreTrashItem={vi.fn()}
          onSelectEntry={vi.fn()}
          onSelectTag={vi.fn()}
          onUpdateEntry={vi.fn()}
        />
      </ToastContext.Provider></TooltipProvider>
    );

    expect(screen.getByRole('button', { name: '表头' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: '标签' })).toBeNull();
  });
});
