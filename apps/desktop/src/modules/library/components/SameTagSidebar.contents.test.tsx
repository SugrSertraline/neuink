// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { useReducer } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { entryContentSurface, initialWorkspaceSurfaceLayout, surfaceKey, workspaceSurfaceOpenActions, workspaceSurfaceReducer, type WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { useSameTagContext } from '@/app/useSameTagContext';
import { SameTagSidebar } from './SameTagSidebar';
import type { LibraryEntry } from './LibrarySidebar';

const entry: LibraryEntry = { id: 'one', title: '跨论文需求对齐', tagIds: ['tag'], tags: ['软件工程'],
  contents: [{ kind: 'note', note_id: 'summary', title: '阅读摘要' }, { kind: 'note', note_id: 'comparison', title: '方法对比' }],
  fields: {}, createdAt: '', updatedAt: '', pdfFileName: 'one.pdf', status: 'Parsed', progress: 100, parseMessage: null, parseEndpoint: null };
const tags = [{ id: 'tag', name: '软件工程', parent_id: null, created_at: '', updated_at: '' }];
const props = { entries: [entry], tags, tagId: 'tag', descendants: true, status: 'ready' as const, error: null,
  layout: initialWorkspaceSurfaceLayout, onTagChange: vi.fn(), onDescendantsChange: vi.fn(), onRead: vi.fn(), onDetails: vi.fn(), onOpenContent: vi.fn() };
const expand = (view: ReturnType<typeof render>) => fireEvent.click(view.getByRole('button', { name: '展开论文内容 跨论文需求对齐' }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('separates expansion from reading and retains both folding levels across filters', () => {
  const view = render(<TooltipProvider><SameTagSidebar {...props} /></TooltipProvider>);
  expect(view.queryByRole('group', { name: '跨论文需求对齐 的内部内容' })).toBeNull();
  expand(view);
  for (const name of ['PDF 原文', '重排阅读', '片段记录', '引用此文', '阅读摘要', '方法对比']) {
    expect(view.getByRole('button', { name: new RegExp(`^${name} `) })).toBeTruthy();
  }
  expect(props.onRead).not.toHaveBeenCalled();
  expect(props.onOpenContent).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '收起文档笔记 跨论文需求对齐' }));
  fireEvent.keyDown(view.getByRole('button', { name: '收起论文内容 跨论文需求对齐' }), { key: 'ArrowLeft' });
  fireEvent.keyDown(view.getByRole('button', { name: '展开论文内容 跨论文需求对齐' }), { key: 'ArrowRight' });
  expect(view.queryByRole('button', { name: /^阅读摘要 / })).toBeNull();
  fireEvent.change(view.getByRole('textbox', { name: '搜索标签或论文' }), { target: { value: 'missing' } });
  fireEvent.click(view.getByRole('button', { name: '清除搜索' }));
  expect(view.getByRole('button', { name: '收起论文内容 跨论文需求对齐' }).getAttribute('aria-expanded')).toBe('true');
  expect(view.getByRole('button', { name: '展开文档笔记 跨论文需求对齐' }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.keyDown(view.getByRole('button', { name: '展开文档笔记 跨论文需求对齐' }), { key: 'ArrowRight' });
  fireEvent.click(view.getByRole('button', { name: /^阅读摘要 / }));
  expect(props.onOpenContent).toHaveBeenLastCalledWith(entry, 'note:summary', undefined);
  expect(props.onRead).not.toHaveBeenCalled();
});

it('opens notes without a PDF, explains unavailable reflow and follows live note changes', () => {
  const metadata: LibraryEntry = { ...entry, pdfFileName: null, status: 'No PDF' };
  const view = render(<TooltipProvider><SameTagSidebar {...props} entries={[metadata]} /></TooltipProvider>);
  expand(view);
  expect(view.queryByRole('button', { name: /^PDF 原文 / })).toBeNull();
  expect(view.getByRole('button', { name: '重排阅读 未解析' }).hasAttribute('disabled')).toBe(true);
  expect(view.getByRole('button', { name: '在右侧打开 重排阅读' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(view.getByRole('button', { name: /^方法对比 / }));
  expect(props.onOpenContent).toHaveBeenLastCalledWith(metadata, 'note:comparison', undefined);
  const parsed = { ...metadata, status: 'Parsed' as const, contents: [{ ...entry.contents[0], title: '更新后的摘要' }] };
  view.rerender(<TooltipProvider><SameTagSidebar {...props} entries={[parsed]} /></TooltipProvider>);
  expect(view.getByRole('button', { name: '重排阅读 解析正文' }).hasAttribute('disabled')).toBe(false);
  expect(view.queryByRole('button', { name: /^方法对比 / })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: /^更新后的摘要 / }));
  expect(props.onOpenContent).toHaveBeenLastCalledWith(parsed, 'note:summary', undefined);
  view.rerender(<TooltipProvider><SameTagSidebar {...props} entries={[{ ...parsed, contents: [] }]} /></TooltipProvider>);
  expect(view.getByText('暂无文档笔记')).toBeTruthy();
  expect(view.queryByRole('button', { name: /^更新后的摘要 / })).toBeNull();
});

const layout = [
  { type: 'open' as const, pane: 'left' as const, surface: entryContentSurface('one', 'pdf', 'tag') },
  { type: 'open' as const, pane: 'right' as const, surface: entryContentSurface('two', 'pdf', 'other') },
  { type: 'focus' as const, pane: 'left' as const }
].reduce(workspaceSurfaceReducer, initialWorkspaceSurfaceLayout);

function ConnectedSidebar() {
  const [state, dispatch] = useReducer(workspaceSurfaceReducer, layout);
  const scope = useSameTagContext('workspace', state, [entry], tags, 'tag');
  return <TooltipProvider><SameTagSidebar {...props} layout={state} tagId={scope.tagId} currentEntryId={scope.entryId}
    contextKey={scope.contextKey} descendants={scope.descendants} onTagChange={scope.selectTag} onDescendantsChange={scope.setDescendants}
    onOpenContent={(item, id, pane) => workspaceSurfaceOpenActions(state, entryContentSurface(item.id, id, scope.tagId ?? undefined), pane).forEach(dispatch)} />
    <button onClick={() => dispatch({ type: 'focus', pane: 'right' })}>聚焦右栏</button>
    <output aria-label="工作区布局">{JSON.stringify(state)}</output>
  </TooltipProvider>;
}
const readLayout = (view: ReturnType<typeof render>): WorkspaceSurfaceLayout => JSON.parse(view.getByLabelText('工作区布局').textContent!);

it('preserves scope, search and scroll; reuses an open content tab and splits only explicitly', () => {
  const view = render(<ConnectedSidebar />);
  expand(view);
  fireEvent.change(view.getByRole('textbox', { name: '搜索标签或论文' }), { target: { value: '跨论文' } });
  fireEvent.click(view.getByRole('button', { name: '收起标签选择' }));
  fireEvent.click(view.getByRole('button', { name: '包含子标签' }));
  const viewport = view.container.querySelector<HTMLElement>('[data-sidebar-panel="论文"] [data-slot="scroll-area-viewport"]')!;
  viewport.scrollTop = 170;
  fireEvent.click(view.getByRole('button', { name: /^阅读摘要 / }));
  expect(readLayout(view).left).toEqual({ kind: 'note', entryId: 'one', noteId: 'summary' });
  expect(readLayout(view).right).toEqual(layout.right);
  expect(view.getByRole('button', { name: /^阅读摘要 / }).getAttribute('aria-current')).toBe('page');
  expect(view.getByText('左侧已打开 · 文档笔记')).toBeTruthy();
  expect(viewport.scrollTop).toBe(170);
  expect(view.container.querySelector('[data-sidebar-panel="论文"] [data-slot="scroll-area-viewport"]')).toBe(viewport);
  expect((view.getByRole('textbox', { name: '搜索标签或论文' }) as HTMLInputElement).value).toBe('跨论文');
  expect(view.getByRole('button', { name: '展开标签选择' })).toBeTruthy();
  expect(view.getByRole('button', { name: '包含子标签' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(view.getByRole('button', { name: '聚焦右栏' }));
  expect(view.getByRole('button', { name: /^阅读摘要 / }).hasAttribute('aria-current')).toBe(false);
  fireEvent.click(view.getByRole('button', { name: /^阅读摘要 / }));
  expect(readLayout(view).focusedPane).toBe('left');
  expect(readLayout(view).right).toEqual(layout.right);
  fireEvent.click(view.getByRole('button', { name: '在右侧打开 阅读摘要' }));
  const moved = readLayout(view);
  expect(moved.right).toEqual({ kind: 'note', entryId: 'one', noteId: 'summary' });
  expect([...moved.leftTabs, ...moved.rightTabs].filter(tab => surfaceKey(tab) === 'note:one:summary')).toHaveLength(1);
  expect(moved.rightTabs.some(tab => surfaceKey(tab) === 'pdf:two')).toBe(true);
  fireEvent.click(view.getByRole('button', { name: '在左侧打开 重排阅读' }));
  expect(readLayout(view).left).toEqual({ kind: 'reflow', entryId: 'one', contextTagId: 'tag' });
  expect(readLayout(view).right).toEqual(moved.right);
});

it('offers internal content in the collapsed paper context menu and per-content split actions', async () => {
  const view = render(<TooltipProvider><SameTagSidebar {...props} /></TooltipProvider>);
  fireEvent.contextMenu(view.getByRole('button', { name: /^跨论文需求对齐 / }), { clientX: 70, clientY: 80 });
  fireEvent.click(await view.findByRole('menuitem', { name: '阅读摘要' }));
  expect(props.onOpenContent).toHaveBeenLastCalledWith(entry, 'note:summary', undefined);
  await waitFor(() => expect(view.queryByRole('menu')).toBeNull());
  expand(view);
  const content = view.getByRole('button', { name: /^片段记录 / });
  act(() => content.focus());
  fireEvent.contextMenu(content, { clientX: 70, clientY: 180 });
  const menu = await view.findByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name: '在右侧打开' }));
  expect(props.onOpenContent).toHaveBeenLastCalledWith(entry, 'segment-notes', 'right');
  await waitFor(() => expect(view.queryByRole('menu')).toBeNull());
  expect(document.activeElement).toBe(content);
  expect(props.onRead).not.toHaveBeenCalled();
});

it('navigates between each disclosure and its children with arrow keys without opening content', () => {
  const view = render(<TooltipProvider><SameTagSidebar {...props} /></TooltipProvider>);
  expand(view);
  const paperToggle = view.getByRole('button', { name: '收起论文内容 跨论文需求对齐' });
  act(() => paperToggle.focus());
  fireEvent.keyDown(paperToggle, { key: 'ArrowRight' });
  const pdf = view.getByRole('button', { name: /^PDF 原文 / });
  expect(document.activeElement).toBe(pdf);
  fireEvent.keyDown(pdf, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(paperToggle);

  const notesToggle = view.getByRole('button', { name: '收起文档笔记 跨论文需求对齐' });
  act(() => notesToggle.focus());
  fireEvent.keyDown(notesToggle, { key: 'ArrowRight' });
  const summary = view.getByRole('button', { name: /^阅读摘要 / });
  expect(document.activeElement).toBe(summary);
  fireEvent.keyDown(summary, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(notesToggle);
  expect(notesToggle.getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(notesToggle, { key: 'ArrowLeft' });
  expect(notesToggle.getAttribute('aria-expanded')).toBe('false');
  expect(view.queryByRole('button', { name: /^阅读摘要 / })).toBeNull();
  fireEvent.keyDown(notesToggle, { key: 'ArrowLeft' });
  expect(document.activeElement).toBe(paperToggle);
  fireEvent.keyDown(paperToggle, { key: 'ArrowLeft' });
  expect(paperToggle.getAttribute('aria-expanded')).toBe('false');
  expect(props.onRead).not.toHaveBeenCalled();
  expect(props.onOpenContent).not.toHaveBeenCalled();
});

it('marks the current leaf once and keeps its location visible when its ancestors collapse', () => {
  const view = render(<ConnectedSidebar />);
  expand(view);
  expect(view.getByRole('button', { name: /^PDF 原文 / }).getAttribute('aria-current')).toBe('page');
  expect(view.getByRole('button', { name: /^跨论文需求对齐 / }).hasAttribute('aria-current')).toBe(false);
  fireEvent.click(view.getByRole('button', { name: /^阅读摘要 / }));
  const group = view.getByRole('group', { name: '跨论文需求对齐 的内部内容' });
  expect(within(group).getAllByRole('button', { current: 'page' })).toHaveLength(1);
  fireEvent.click(view.getByRole('button', { name: '收起文档笔记 跨论文需求对齐' }));
  expect(view.getByRole('button', { name: '展开文档笔记 跨论文需求对齐' }).textContent).toContain('当前');
  fireEvent.click(view.getByRole('button', { name: '收起论文内容 跨论文需求对齐' }));
  const paper = view.getByRole('button', { name: /^跨论文需求对齐 / });
  expect(paper.textContent).toContain('当前：阅读摘要');
  expect(paper.getAttribute('aria-current')).toBe('page');
  expect(readLayout(view).left).toEqual({ kind: 'note', entryId: 'one', noteId: 'summary' });
  expand(view);
  expect(view.getByRole('button', { name: '展开文档笔记 跨论文需求对齐' }).getAttribute('aria-expanded')).toBe('false');
});
