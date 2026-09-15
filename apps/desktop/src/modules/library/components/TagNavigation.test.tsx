// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagPreferencesProvider } from '@/shared/components/TagPreferencesProvider';
import { beginEntryTagDrag, cancelEntryTagDrag, finishEntryTagDrag } from '@/shared/lib/entryDragData';
import { TAG_PREFERENCES_STORAGE_KEY, type TagNavigationMode } from '@/shared/lib/tagPreferences';
import { buildTagTree } from '../utils/tagTree';
import { TagNavigation } from './TagNavigation';
import { TAG_EXPANSION_STORAGE_KEY } from './useTagTreeExpansion';

const nodes = buildTagTree([
  { id: 'root', parent_id: null, name: '研究', created_at: '', updated_at: '' },
  { id: 'software', parent_id: 'root', name: '软件工程', created_at: '', updated_at: '' },
  { id: 'code', parent_id: 'software', name: '代码生成', created_at: '', updated_at: '' },
  { id: 'ai', parent_id: 'root', name: 'AI', created_at: '', updated_at: '' },
  { id: 'project', parent_id: null, name: '项目', created_at: '', updated_at: '' },
  { id: 'project-code', parent_id: 'project', name: '代码生成', created_at: '', updated_at: '' }
], [{ tagIds: ['root', 'software', 'code', 'ai'] }]);

function Harness({ initial = null, onAssign = vi.fn(), onEdit = vi.fn(), onOpen = vi.fn(), status = 'ready', empty = false }: { initial?: string | null; onAssign?: (id: string, path: string) => void; onEdit?: () => void; onOpen?: (id: string) => void; status?: 'ready' | 'loading' | 'error'; empty?: boolean }) {
  const [active, setActive] = useState<string | null>(initial);
  const [open, setOpen] = useState(true);
  return <TagPreferencesProvider>
    <output aria-label="当前标签">{active ?? 'all'}</output>
    <TagNavigation activeTag={active} nodes={empty ? [] : nodes} status={status} error={status === 'error' ? '读取失败' : null} onAssignEntryToTag={onAssign} onOpenTagDetails={id => { setActive(id); onOpen(id); }} open={open}
      onToggleOpen={() => setOpen(value => !value)} onEditTags={onEdit} />
  </TagPreferencesProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); cancelEntryTagDrag(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function changeMode(view: ReturnType<typeof render>, label: string) {
  fireEvent.keyDown(view.getByRole('button', { name: '标签导航与显示设置' }), { key: 'Enter' });
  fireEvent.click(view.getByRole('menuitemradio', { name: label }));
}

function openSearch(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole('button', { name: '搜索标签' }));
  return view.getByRole('textbox', { name: '搜索标签或路径' });
}

describe('TagNavigation', () => {
  it('keeps the all-tags path, search and edit in a single sticky row', () => {
    const view = render(<Harness />);
    const header = view.getByRole('button', { name: '全部标签' }).closest('[data-slot="tag-navigation-header"]')!;
    expect(header.parentElement!.className).toContain('sticky');
    expect(header.parentElement!.className).toContain('bg-card');
    expect(header.className).not.toContain('flex-col');
    expect(header.className).not.toContain('flex-wrap');
    expect(view.queryByRole('textbox', { name: '搜索标签或路径' })).toBeNull();
    expect(header.contains(view.getByRole('button', { name: '搜索标签' }))).toBe(true);
    expect(view.getByRole('button', { name: '搜索标签' }).nextElementSibling).toBe(view.getByRole('button', { name: '编辑标签' }));
    expect(header.contains(view.getByRole('navigation', { name: '标签浏览路径' }))).toBe(true);
    expect(view.queryByRole('button', { name: '返回上一级标签' })).toBeNull();
    expect(view.getByText('顶层标签').className).toContain('sr-only');
    expect(view.queryByRole('button', { name: '上一级' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '浏览子标签 研究' }));
    expect(view.queryByRole('button', { name: '返回上一级标签' })).toBeNull();
    expect(header.contains(view.getByRole('button', { name: '上一级' }))).toBe(false);
    const search = openSearch(view);
    expect(header.contains(search)).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(view.queryByRole('navigation', { name: '标签浏览路径' })).toBeNull();
    expect(view.queryByRole('button', { name: '上一级' })).toBeNull();
  });

  it('keeps directory navigation in the sidebar and restores focus without changing the open tag', () => {
    const onOpen = vi.fn();
    const view = render(<Harness initial="code" onOpen={onOpen} />);
    fireEvent.click(view.getByRole('button', { name: '浏览子标签 研究' }));
    fireEvent.click(view.getByRole('button', { name: '浏览子标签 研究/软件工程' }));
    const up = view.getByRole('button', { name: '上一级' });
    const parentRow = up.closest('[data-slot="tag-navigation-parent"]')!;
    const sticky = parentRow.parentElement!;
    expect(sticky.getAttribute('data-slot')).toBe('tag-navigation-sticky');
    expect(sticky.className).toContain('sticky');
    expect(sticky.className).toContain('bg-card');
    expect(parentRow.previousElementSibling?.getAttribute('data-slot')).toBe('tag-navigation-header');
    const bodyId = view.getByRole('button', { name: '收起标签' }).getAttribute('aria-controls')!;
    expect(sticky.contains(document.getElementById(bodyId))).toBe(false);
    expect(up.getAttribute('title')).toBe('返回 研究');
    fireEvent.click(view.getByRole('button', { name: '收起标签' }));
    expect(view.queryByRole('button', { name: '上一级' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '展开标签' }));
    fireEvent.click(view.getByRole('button', { name: '上一级' }));
    expect(view.getByRole('button', { name: '上一级' }).textContent).toContain('全部标签');
    fireEvent.click(view.getByRole('button', { name: '上一级' }));
    expect(view.queryByRole('button', { name: '上一级' })).toBeNull();
    expect(document.activeElement).toBe(view.getByRole('button', { name: '全部标签' }));
    expect(view.getByLabelText('当前标签').textContent).toBe('code');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('leaves section actions reachable when collapsed and preserves the search and filter on reopening', () => {
    const view = render(<Harness initial="code" />);
    fireEvent.change(openSearch(view), { target: { value: '代码生成' } });
    fireEvent.click(view.getByRole('button', { name: '收起标签' }));
    expect(view.queryByRole('textbox', { name: '搜索标签或路径' })).toBeNull();
    expect(view.queryByRole('button', { name: '打开标签 研究/软件工程/代码生成' })).toBeNull();
    expect(view.getByRole('button', { name: '展开标签' }).getAttribute('aria-expanded')).toBe('false');
    changeMode(view, '路径列表');
    expect(view.getByRole('button', { name: '展开标签' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(view.getByRole('button', { name: '展开标签' }));
    expect((view.getByRole('textbox', { name: '搜索标签或路径' }) as HTMLInputElement).value).toBe('代码生成');
    expect(view.getByLabelText('当前标签').textContent).toBe('code');
    expect(view.getByText('找到 2 个标签')).toBeTruthy();
  });

  it('opens a collapsed section for search, keeps edit independent and closes an empty search with Escape', () => {
    const onEdit = vi.fn();
    const view = render(<Harness initial="code" onEdit={onEdit} />);
    fireEvent.click(view.getByRole('button', { name: '收起标签' }));
    fireEvent.click(view.getByRole('button', { name: '编辑标签' }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(view.getByRole('button', { name: '展开标签' })).toBeTruthy();
    const search = openSearch(view);
    expect(document.activeElement).toBe(search);
    expect(view.getByRole('button', { name: '收起标签' })).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape', isComposing: true });
    expect(view.getByRole('textbox', { name: '搜索标签或路径' })).toBe(search);
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(view.queryByRole('textbox', { name: '搜索标签或路径' })).toBeNull();
    expect(document.activeElement).toBe(view.getByRole('button', { name: '搜索标签' }));
    expect(view.getByLabelText('当前标签').textContent).toBe('code');
  });

  it.each(['directory', 'paths', 'tree'] as TagNavigationMode[])('opens details on one pointer click in %s mode without navigating the directory', mode => {
    window.localStorage.setItem(TAG_PREFERENCES_STORAGE_KEY, JSON.stringify({ navigationMode: mode }));
    const onOpen = vi.fn();
    const view = render(<Harness onOpen={onOpen} />);
    const root = view.getByRole('button', { name: '打开标签 研究' });
    fireEvent.click(root, { detail: 1 });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('root');
    expect(view.getByLabelText('当前标签').textContent).toBe('root');
    expect(view.getByRole('button', { name: '打开标签 研究' })).toBe(root);
    expect(root.getAttribute('aria-current')).toBe('page');
    expect(view.queryByRole('button', { name: '上一级' })).toBeNull();
    fireEvent.click(root, { detail: 0 });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('browses branches with arrows and breadcrumbs while detail selection stays independent', () => {
    const onOpen = vi.fn();
    const view = render(<Harness onOpen={onOpen} />);
    fireEvent.click(view.getByRole('button', { name: '浏览子标签 研究' }));
    expect(document.activeElement).toBe(within(view.getByRole('navigation')).getByRole('button', { name: '研究' }));
    fireEvent.click(view.getByRole('button', { name: '浏览子标签 研究/软件工程' }));
    fireEvent.click(view.getByRole('button', { name: '打开标签 研究/软件工程/代码生成' }), { detail: 1 });
    expect(view.getByLabelText('当前标签').textContent).toBe('code');
    const breadcrumb = within(view.getByRole('navigation', { name: '标签浏览路径' }));
    expect(breadcrumb.getByRole('button', { name: '软件工程' }).getAttribute('aria-current')).toBe('location');
    fireEvent.keyDown(breadcrumb.getByRole('button', { name: '软件工程' }), { key: 'Enter' });
    fireEvent.click(view.getByRole('menuitem', { name: '全部标签' }));
    expect(view.getByLabelText('当前标签').textContent).toBe('code');
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('code');
    expect(document.activeElement).toBe(breadcrumb.getByRole('button', { name: '全部标签' }));
  });

  it('switches modes without changing the filter and remembers mode and branch expansion', () => {
    const view = render(<Harness initial="code" />);
    changeMode(view, '树形导航');
    expect(view.getByLabelText('当前标签').textContent).toBe('code');
    expect(view.getByRole('button', { name: '收起 软件工程' })).toBeTruthy();
    fireEvent.keyDown(view.getByRole('button', { name: '标签导航与显示设置' }), { key: 'Enter' });
    fireEvent.click(view.getByRole('menuitem', { name: '收起全部' }));
    expect(view.getByLabelText('当前标签').textContent).toBe('code');
    expect(view.queryByRole('button', { name: '打开标签 研究/软件工程' })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(TAG_EXPANSION_STORAGE_KEY)!)).toEqual([]);
    fireEvent.click(view.getByRole('button', { name: '展开 项目' }));
    view.unmount();
    const reopened = render(<Harness />);
    expect(reopened.getByRole('button', { name: '收起 项目' })).toBeTruthy();
    expect(reopened.getByRole('button', { name: '展开 研究' })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(TAG_PREFERENCES_STORAGE_KEY)!).navigationMode).toBe('tree');
  });

  it('finds full paths across branches and restores the current directory on Escape', () => {
    const view = render(<Harness />);
    fireEvent.click(view.getByRole('button', { name: '浏览子标签 研究' }));
    fireEvent.click(view.getByRole('button', { name: '浏览子标签 研究/软件工程' }));
    const search = openSearch(view);
    fireEvent.change(search, { target: { value: '代码生成' } });
    expect(view.getByText('找到 2 个标签')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '打开标签 研究/软件工程/代码生成' }));
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(view.getByLabelText('当前标签').textContent).toBe('code');
    expect(view.getByText('子标签')).toBeTruthy();
    expect(view.queryByRole('button', { name: '打开标签 项目/代码生成' })).toBeNull();
    expect(document.activeElement).toBe(view.getByRole('button', { name: '搜索标签' }));
    fireEvent.change(openSearch(view), { target: { value: 'absent' } });
    expect(view.getByText('没有匹配的标签，请尝试其他名称或路径。')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: '关闭标签搜索' }));
    expect(document.activeElement).toBe(view.getByRole('button', { name: '搜索标签' }));
    expect(view.getByLabelText('当前标签').textContent).toBe('code');
  });

  it('shows flat paths, optional counts and density without removing ancestor folders', () => {
    const view = render(<Harness />);
    changeMode(view, '路径列表');
    expect(view.getByRole('button', { name: '打开标签 研究/软件工程/代码生成' }).getAttribute('title')).toBe('进入标签：研究/软件工程/代码生成');
    expect(view.getByRole('button', { name: '打开标签 研究' }).querySelector('[data-count-kind="children"]')?.textContent).toBe('2');
    expect(view.getByRole('button', { name: '打开标签 研究' }).querySelector('[data-count-kind="papers"]')?.textContent).toBe('1');
    changeMode(view, '舒适');
    fireEvent.keyDown(view.getByRole('button', { name: '标签导航与显示设置' }), { key: 'Enter' });
    fireEvent.click(view.getByRole('menuitemcheckbox', { name: '显示子标签和论文数量' }));
    const row = view.getByRole('button', { name: '打开标签 研究' });
    expect(row.querySelector('[data-count-kind]')).toBeNull();
    expect(row.className).toContain('min-h-10');
  });

  it.each(['loading', 'error', 'empty'] as const)('distinguishes the %s state without showing stale counts or drop targets', state => {
    const view = render(<Harness status={state === 'empty' ? 'ready' : state} empty={state === 'empty'} />);
    expect(view.queryByRole('button', { name: '打开标签 研究' })).toBeNull();
    expect((view.getByRole('button', { name: '编辑标签' }) as HTMLButtonElement).disabled).toBe(state !== 'empty');
    expect(view.getByText(state === 'loading' ? '正在加载标签…' : state === 'error' ? '无法加载标签。读取失败' : '暂无标签，可通过“编辑标签”创建。')).toBeTruthy();
  });

  it.each(['directory', 'paths', 'tree'] as TagNavigationMode[])('preserves drop and cancellation contracts in %s mode', mode => {
    window.localStorage.setItem(TAG_PREFERENCES_STORAGE_KEY, JSON.stringify({ navigationMode: mode }));
    const onAssign = vi.fn();
    const view = render(<Harness onAssign={onAssign} />);
    const row = view.getByRole('button', { name: '打开标签 研究' }).parentElement!;
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ left: 10, right: 200, top: 10, bottom: 40 } as DOMRect);
    act(() => beginEntryTagDrag('paper', 20, 20));
    act(() => cancelEntryTagDrag());
    expect(onAssign).not.toHaveBeenCalled();
    act(() => beginEntryTagDrag('paper', 20, 20));
    act(() => finishEntryTagDrag(20, 20));
    expect(onAssign).toHaveBeenCalledExactlyOnceWith('paper', '研究');
    act(() => beginEntryTagDrag('paper', 20, 20));
    view.unmount();
    act(() => finishEntryTagDrag(20, 20));
    expect(onAssign).toHaveBeenCalledTimes(1);
  });
});
