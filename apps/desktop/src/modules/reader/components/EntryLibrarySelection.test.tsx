// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppearanceProvider, APP_APPEARANCE_STORAGE_KEY } from '@/shared/components/AppearanceProvider';
import { ToastContext } from '@/shared/hooks/useToast';
import { EntryLibraryView } from './EntryLibraryView';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { window.localStorage.clear(); });
const entries = ['甲', '乙', '丙'].map((suffix, index) => ({ id: `paper-${index}`, title: `论文${suffix}`, tags: [], tagIds: [], fields: {}, contents: [], pdfFileName: 'paper.pdf', status: 'Parsed', progress: 100, parseMessage: null, parseEndpoint: null, createdAt: '', updatedAt: '' } as LibraryEntry));
function setup(overrides: Partial<ComponentProps<typeof EntryLibraryView>> = {}) {
  const props: ComponentProps<typeof EntryLibraryView> = {
    entries, standalone: true, activeTag: null, libraryView: 'all', section: 'papers', filterResetKey: 0, recentReadingEntryIds: [], selectedEntryId: null, status: 'ready', tags: [], workspaceRoot: null, trashedEntries: [], trashItems: [], isRefreshingParseStatus: false,
    onSelectView: vi.fn(), onClearFilters: vi.fn(), onManageTags: vi.fn(), onOpenDailyDashboard: vi.fn(), onDeleteEntry: vi.fn(async () => undefined), onOpenCreateEntryTab: vi.fn(), onOpenEntryExplorer: vi.fn(), onOpenEntryInSidePane: vi.fn(), onPurgeEntry: vi.fn(), onPurgeTrashItem: vi.fn(), onRefreshParseStatus: vi.fn(), onReparseEntry: vi.fn(), onRestoreEntry: vi.fn(), onRestoreTrashItem: vi.fn(), onSelectEntry: vi.fn(), onSelectTag: vi.fn(), onUpdateEntry: vi.fn(), onApplyEntryTagPaths: vi.fn(async () => undefined), ...overrides,
  };
  const result = render(<EntryLibraryView {...props} />, { wrapper: ({ children }) => <AppearanceProvider><TooltipProvider><ToastContext.Provider value={{ notify: vi.fn(() => 'toast'), dismiss: vi.fn() }}>{children}</ToastContext.Provider></TooltipProvider></AppearanceProvider> });
  return { props, rerender: (next: Partial<typeof props>) => result.rerender(<EntryLibraryView {...props} {...next} />) };
}
const chooseMode = () => fireEvent.click(screen.getByRole('button', { name: '选择模式' }));
const chooseAll = () => fireEvent.click(screen.getByRole('button', { name: '全选当前结果' }));
const row = (title: string) => screen.getByRole('row', { name: new RegExp(title) });
const sources = () => ({ sources: { 'paper-1': { kinds: ['zotero'] as ('zotero' | 'mineru')[], hidden: false, zotero_hidden: false } }, loading: false, error: false, setHidden: vi.fn(async () => undefined) });

it('keeps only search and selection tools until selection mode ends', () => {
  setup();
  expect(screen.getByRole('combobox', { name: '条目排序' })).toBeTruthy();
  chooseMode();
  expect(screen.getByRole('textbox', { name: '搜索条目' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: '条目排序' })).toBeNull();
  expect(screen.queryByRole('button', { name: '表头' })).toBeNull();
  expect(screen.queryByRole('button', { name: '标签导航' })).toBeNull();
  chooseAll();
  expect(screen.getByRole('button', { name: '移入回收站 3 篇' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '退出选择' }));
  expect(screen.getByRole('combobox', { name: '条目排序' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '表头' })).toBeTruthy();
});

it('keeps selection actions in the existing toolbar and adds only the checkbox column', () => {
  setup();
  const toolbar = screen.getByLabelText('条目库筛选与操作');
  const headerCount = screen.getAllByRole('columnheader').length;
  chooseMode();
  expect(toolbar.contains(screen.getByRole('region', { name: '批量操作' }))).toBe(true);
  expect(toolbar.contains(screen.getByRole('button', { name: '退出选择' }))).toBe(true);
  expect(screen.queryByRole('button', { name: '选择模式' })).toBeNull();
  expect(screen.getAllByRole('columnheader')).toHaveLength(headerCount + 1);
  fireEvent.click(within(toolbar).getByRole('button', { name: '全选当前结果' }));
  expect(screen.getByRole('region', { name: '批量操作' }).textContent).toContain('已选 3 / 3 篇');
  fireEvent.click(within(toolbar).getByRole('button', { name: '取消全选' }));
  expect(screen.getByRole('region', { name: '批量操作' }).textContent).toContain('已选 0 / 3 篇');
  fireEvent.click(within(toolbar).getByRole('button', { name: '退出选择' }));
  expect(screen.getAllByRole('columnheader')).toHaveLength(headerCount);
  expect(screen.queryByRole('region', { name: '批量操作' })).toBeNull();
  expect(within(toolbar).getByRole('button', { name: '选择模式' })).toBeTruthy();
});

it('adds checkboxes, supports Shift ranges and Escape, and prevents selection clicks from opening or dragging papers', () => {
  const { props } = setup();
  expect(screen.queryByRole('checkbox', { name: '选择 论文甲' })).toBeNull();
  chooseMode();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 论文甲' }));
  expect(screen.getByRole('checkbox', { name: '全选当前结果' }).getAttribute('aria-checked')).toBe('mixed');
  fireEvent.click(row('论文丙'), { shiftKey: true });
  expect(screen.getByRole('region', { name: '批量操作' }).textContent).toContain('已选 3 / 3 篇');
  expect(row('论文乙').getAttribute('aria-selected')).toBe('true');
  fireEvent.doubleClick(row('论文乙'));
  expect(props.onOpenEntryExplorer).not.toHaveBeenCalled();
  fireEvent.keyDown(row('论文乙'), { key: 'Escape' });
  expect(screen.queryByRole('region', { name: '批量操作' })).toBeNull();
  fireEvent.doubleClick(row('论文乙'));
  expect(props.onOpenEntryExplorer).toHaveBeenCalledWith('paper-1');
});

it('limits select-all to filtered results, clears selection when filters change and leaves text editing shortcuts alone', () => {
  setup(); chooseMode();
  const search = screen.getByRole('textbox', { name: '搜索条目' });
  fireEvent.keyDown(search, { key: 'a', ctrlKey: true });
  expect(screen.getByRole('region', { name: '批量操作' }).textContent).toContain('已选 0 / 3 篇');
  fireEvent.keyDown(row('论文甲'), { key: 'a', ctrlKey: true });
  expect(screen.getByRole('checkbox', { name: '全选当前结果' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.change(search, { target: { value: '论文乙' } });
  expect(screen.getByRole('region', { name: '批量操作' }).textContent).toContain('已选 0 / 1 篇');
  chooseAll();
  expect(screen.getByRole('checkbox', { name: '选择 论文乙' }).getAttribute('aria-checked')).toBe('true');
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getByRole('region', { name: '批量操作' }).textContent).toContain('已选 0 / 3 篇');
});

it('separates batch source hiding from local deletion and confirms the exact scope', async () => {
  const catalog = sources(); const { props } = setup({ workspaceRoot: 'library', librarySourceCatalog: catalog });
  chooseMode(); chooseAll();
  fireEvent.click(screen.getByRole('button', { name: '隐藏来源 1 篇' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('论文乙'); expect(dialog.textContent).not.toContain('论文甲');
  expect(catalog.setHidden).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '确认隐藏来源条目' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(catalog.setHidden).toHaveBeenCalledExactlyOnceWith('paper-1', true);
  expect(props.onDeleteEntry).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '移入回收站 2 篇' }));
  expect(screen.getByRole('dialog').textContent).not.toContain('论文乙');
  fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(props.onDeleteEntry).toHaveBeenCalledTimes(2);
  expect(props.onDeleteEntry).toHaveBeenCalledWith('paper-0'); expect(props.onDeleteEntry).toHaveBeenCalledWith('paper-2');
});

it('retries only failed batch items and retains the failed selection', async () => {
  const remove = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('busy')).mockResolvedValue(undefined);
  setup({ entries: entries.slice(0, 2), onDeleteEntry: remove }); chooseMode(); chooseAll();
  fireEvent.click(screen.getByRole('button', { name: '移入回收站 2 篇' }));
  fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('dialog').textContent).not.toContain('论文甲');
  fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(remove.mock.calls.map(([id]) => id)).toEqual(['paper-0', 'paper-1', 'paper-1']);
});

it('adds local tags through the append operation without replacing metadata', async () => {
  const { props } = setup(); chooseMode(); chooseAll();
  fireEvent.click(screen.getByRole('button', { name: '添加标签' }));
  fireEvent.change(screen.getByRole('combobox', { name: '标签路径' }), { target: { value: '研究 / 待阅读' } });
  fireEvent.click(screen.getByRole('button', { name: '确认添加标签' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(props.onApplyEntryTagPaths).toHaveBeenCalledTimes(3);
  expect(props.onApplyEntryTagPaths).toHaveBeenCalledWith('paper-0', ['研究/待阅读']);
  expect(props.onUpdateEntry).not.toHaveBeenCalled();
});

it('right-clicking another row extends the selection and closing its menu preserves selection mode', () => {
  setup(); chooseMode(); fireEvent.click(row('论文甲'));
  fireEvent.contextMenu(row('论文乙'));
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(row('论文甲').getAttribute('aria-selected')).toBe('true');
  expect(row('论文乙').getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('button', { name: '退出选择' })).toBeTruthy();
});

it('hides display switching during bookshelf selection and restores it on exit', () => {
  window.localStorage.setItem(APP_APPEARANCE_STORAGE_KEY, 'atelier');
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  setup(); chooseMode();
  const book = screen.getByRole('listitem', { name: '论文甲' });
  fireEvent.click(within(book).getByRole('checkbox', { name: '选择 论文甲' }));
  expect(book.getAttribute('data-state')).toBe('selected');
  expect(screen.queryByRole('radio', { name: '列表' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '退出选择' }));
  fireEvent.click(screen.getByRole('radio', { name: '列表' }));
  expect(row('论文甲')).toBeTruthy();
});

it.each(['loading', 'error'] as const)('prevents entering selection mode while the library is %s', status => {
  setup({ status });
  expect((screen.getByRole('button', { name: '选择模式' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('region', { name: '批量操作' })).toBeNull();
});

it('disables batch actions for an empty result', () => {
  setup({ entries: [] }); chooseMode();
  expect(screen.getByRole('region', { name: '批量操作' }).textContent).toContain('已选 0 / 0 篇');
  expect((screen.getByRole('button', { name: '全选当前结果' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: '添加标签' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: /移入回收站/ })).toBeNull();
});

it('restores hidden source entries without allowing their deletion', async () => {
  const catalog = sources(); catalog.sources['paper-1'].hidden = true;
  setup({ workspaceRoot: 'library', libraryView: 'hidden', librarySourceCatalog: catalog });
  chooseMode(); chooseAll();
  expect(screen.queryByRole('button', { name: /移入回收站/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '恢复来源 1 篇' }));
  fireEvent.click(screen.getByRole('button', { name: '确认恢复来源条目' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(catalog.setHidden).toHaveBeenCalledExactlyOnceWith('paper-1', false);
});

it('stops scheduling a batch after switching workspaces', async () => {
  let finish!: () => void;
  const remove = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const { rerender } = setup({ onDeleteEntry: remove }); chooseMode(); chooseAll();
  fireEvent.click(screen.getByRole('button', { name: '移入回收站 3 篇' }));
  fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
  rerender({ workspaceRoot: 'another-library' });
  finish();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(remove).toHaveBeenCalledExactlyOnceWith('paper-0');
  expect(screen.queryByRole('region', { name: '批量操作' })).toBeNull();
});
