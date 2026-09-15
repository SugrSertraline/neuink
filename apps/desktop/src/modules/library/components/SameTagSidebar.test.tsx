// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initialWorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { SameTagSidebar } from './SameTagSidebar';
import type { LibraryEntry } from './LibrarySidebar';
import { useSameTagContext } from '@/app/useSameTagContext';
import type { WorkspaceSurfaceLayout } from '@/app/workspaceSurface';

const entry: LibraryEntry = { id: 'one', title: '跨论文需求对齐', tagIds: ['tag'], tags: ['软件工程'], contents: [], fields: {}, createdAt: '', updatedAt: '', pdfFileName: 'one.pdf', status: 'Parsed', progress: 100, parseMessage: null, parseEndpoint: null };
const props = { entries: [entry], tags: [{ id: 'tag', name: '软件工程', parent_id: null, created_at: '', updated_at: '' }], tagId: 'tag', descendants: true, status: 'ready' as const, error: null, layout: initialWorkspaceSurfaceLayout,
  onTagChange: vi.fn(), onDescendantsChange: vi.fn(), onRead: vi.fn(), onDetails: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('provides separate left reading, right comparison and detail actions', () => {
  const view = render(<TooltipProvider><SameTagSidebar {...props} /></TooltipProvider>);
  expect(view.queryByText('one.pdf')).toBeNull();
  expect(view.getByText('未开始')).toBeTruthy();
  expect(view.getByRole('progressbar', { name: '跨论文需求对齐 阅读进度' }).getAttribute('aria-valuenow')).toBe('0');
  fireEvent.click(view.getByRole('button', { name: /^跨论文需求对齐 / }));
  expect(props.onRead).toHaveBeenLastCalledWith(entry, 'left');
  fireEvent.click(view.getByRole('button', { name: '在右侧打开 跨论文需求对齐' }));
  expect(props.onRead).toHaveBeenLastCalledWith(entry, 'right');
  fireEvent.click(view.getByRole('button', { name: '查看详情 跨论文需求对齐' }));
  expect(props.onDetails).toHaveBeenCalledWith(entry);
  expect(props.onRead).toHaveBeenCalledTimes(2);
  fireEvent.click(view.getByRole('button', { name: '包含子标签' }));
  expect(props.onDescendantsChange).toHaveBeenCalledWith(false);
});

it('keeps secondary metadata in a keyboard-accessible preview without opening the paper', async () => {
  const view = render(<TooltipProvider><SameTagSidebar {...props} /></TooltipProvider>);
  const row = view.getByRole('button', { name: /^跨论文需求对齐 / });
  expect(row.hasAttribute('title')).toBe(false);
  expect(view.queryByText('one.pdf')).toBeNull();
  act(() => row.focus());
  await waitFor(() => expect(view.getByText('one.pdf')).toBeTruthy());
  expect(view.getByText('0 篇笔记')).toBeTruthy();
  expect(document.activeElement).toBe(row);
  expect(props.onRead).not.toHaveBeenCalled();
  fireEvent.keyDown(row, { key: 'Escape' });
  await waitFor(() => expect(view.queryByText('one.pdf')).toBeNull());
});

it('retains the reading scope on a tag note and changes it only through explicit locate', () => {
  const layout: WorkspaceSurfaceLayout = { ...initialWorkspaceSurfaceLayout, left: { kind: 'owned-note', target: { owner: { kind: 'tag_reading', tag_id: 'tag' }, note_id: 'note' } } };
  const view = render(<TooltipProvider><SameTagSidebar {...props} tagId={null} layout={layout} /></TooltipProvider>);
  expect(view.getByRole('complementary', { name: '标签阅读' })).toBeTruthy();
  expect(props.onTagChange).not.toHaveBeenCalled();
  fireEvent.change(view.getByRole('textbox', { name: '搜索标签或论文' }), { target: { value: 'nothing' } });
  fireEvent.click(view.getByRole('button', { name: '定位笔记所属标签' }));
  expect(props.onTagChange).toHaveBeenCalledWith('tag');
  expect((view.getByRole('textbox', { name: '搜索标签或论文' }) as HTMLInputElement).value).toBe('');
  view.rerender(<TooltipProvider><SameTagSidebar {...props} tags={[]} layout={layout} /></TooltipProvider>);
  expect(view.getByRole('button', { name: '定位笔记所属标签' }).hasAttribute('disabled')).toBe(true);
});

it('selects hierarchical tags and collapses navigation without clearing the paper search', () => {
  const tags = [...props.tags, { ...props.tags[0], id: 'child', name: '需求分析', parent_id: 'tag' }];
  const view = render(<TooltipProvider><SameTagSidebar {...props} tags={tags} /></TooltipProvider>);
  fireEvent.doubleClick(view.getByRole('button', { name: '打开标签 软件工程' }));
  fireEvent.change(view.getByRole('textbox', { name: '搜索标签或论文' }), { target: { value: '需求' } });
  fireEvent.click(view.getByRole('button', { name: '收起标签选择' }));
  expect(view.queryByRole('button', { name: '打开标签 软件工程/需求分析' })).toBeNull();
  expect((view.getByRole('textbox', { name: '搜索标签或论文' }) as HTMLInputElement).value).toBe('需求');
  expect(view.getByRole('button', { name: /^跨论文需求对齐 / })).toBeTruthy();
  expect(view.getByRole('button', { name: '展开标签选择' }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(view.getByRole('button', { name: '展开标签选择' }));
  fireEvent.click(view.getByRole('button', { name: '打开标签 软件工程/需求分析' }));
  expect(props.onTagChange).toHaveBeenCalledWith('child');
  expect((view.getByRole('textbox', { name: '搜索标签或论文' }) as HTMLInputElement).value).toBe('');
  expect(props.onRead).not.toHaveBeenCalled();
});

it('shows all papers at root and searches tags and papers with one input', () => {
  const view = render(<TooltipProvider><SameTagSidebar {...props} tagId={null} /></TooltipProvider>);
  expect(view.getByRole('button', { name: /^跨论文需求对齐 / })).toBeTruthy();
  expect(view.getAllByRole('textbox')).toHaveLength(1);
  expect(view.queryByText('论文列表')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '收起标签选择' }));
  fireEvent.change(view.getByRole('textbox', { name: '搜索标签或论文' }), { target: { value: '软件' } });
  expect(view.getByRole('button', { name: '打开标签 软件工程' })).toBeTruthy();
  expect(view.queryByRole('button', { name: /^跨论文需求对齐 / })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '全部标签' }));
  expect(props.onTagChange).toHaveBeenCalledWith(null);
  expect(view.getByRole('button', { name: /^跨论文需求对齐 / })).toBeTruthy();
});

it('reflects actual open surfaces in action icons and removes the library footer', () => {
  const view = render(<TooltipProvider><SameTagSidebar {...props} /></TooltipProvider>);
  expect(view.queryByRole('button', { name: '返回条目库' })).toBeNull();
  expect(view.getByRole('button', { name: '在右侧打开 跨论文需求对齐' }).getAttribute('aria-pressed')).toBe('false');
  view.rerender(<TooltipProvider><SameTagSidebar {...props} layout={{ ...initialWorkspaceSurfaceLayout, right: { kind: 'entry-overview', entryId: 'one' }, focusedPane: 'right' }} /></TooltipProvider>);
  const right = view.getByRole('button', { name: '在右侧打开 跨论文需求对齐' });
  expect(right.getAttribute('aria-pressed')).toBe('true');
  expect(right.querySelector('.lucide-panel-right')).toBeTruthy();
  expect(view.getByRole('button', { name: '查看详情 跨论文需求对齐' }).querySelector('.lucide-circle-check')).toBeTruthy();
  view.rerender(<TooltipProvider><SameTagSidebar {...props} descendants={false} /></TooltipProvider>);
  expect(view.getByRole('button', { name: '包含子标签' }).querySelector('.lucide-list-filter')).toBeTruthy();
  expect(view.getByRole('button', { name: '在右侧打开 跨论文需求对齐' }).getAttribute('aria-pressed')).toBe('false');
});

it('filters titles and files, and updates when a paper is removed', () => {
  const view = render(<TooltipProvider><SameTagSidebar {...props} /></TooltipProvider>);
  fireEvent.change(view.getByRole('textbox', { name: '搜索标签或论文' }), { target: { value: 'missing' } });
  expect(view.queryByRole('button', { name: /^跨论文需求对齐 / })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '清除搜索' }));
  expect(view.getByRole('button', { name: /^跨论文需求对齐 / })).toBeTruthy();
  view.rerender(<TooltipProvider><SameTagSidebar {...props} entries={[]} /></TooltipProvider>);
  expect(view.queryByRole('button', { name: /^跨论文需求对齐 / })).toBeNull();
  expect(view.getByText(/当前范围暂无论文/)).toBeTruthy();
});

it.each(['loading', 'error', 'deleted'] as const)('hides stale row actions in %s state', state => {
  const view = render(<TooltipProvider><SameTagSidebar {...props} status={state === 'deleted' ? 'ready' : state} tags={state === 'deleted' ? [] : props.tags} /></TooltipProvider>);
  expect(view.queryByRole('button', { name: '在右侧打开 跨论文需求对齐' })).toBeNull();
  if (state === 'loading') expect(view.getAllByRole('status').length).toBeGreaterThan(0);
  if (state === 'error') expect(view.getAllByRole('alert').length).toBeGreaterThan(0);
  if (state === 'deleted') expect(view.getByText(/此标签已移入回收站/)).toBeTruthy();
});

const otherEntry = { ...entry, id: 'two', title: '另一主题论文', tagIds: [], tags: [], pdfFileName: 'two.pdf' };
function ConnectedSidebar({ layout, entries = [entry, otherEntry], status = 'ready' }: { layout: WorkspaceSurfaceLayout; entries?: LibraryEntry[]; status?: 'ready' | 'loading' | 'error' }) {
  const scope = useSameTagContext('workspace', layout, entries, props.tags, null, status === 'ready');
  return <TooltipProvider><SameTagSidebar {...props} entries={entries} layout={layout} status={status}
    tagId={scope.tagId} currentEntryId={scope.entryId} contextKey={scope.contextKey}
    descendants={scope.descendants} onDescendantsChange={scope.setDescendants}
    onTagChange={scope.selectTag} onLocateEntry={scope.locateEntry} /></TooltipProvider>;
}
const paperLayout = (entryId: string): WorkspaceSurfaceLayout => ({ ...initialWorkspaceSurfaceLayout, left: { kind: 'pdf', entryId } });

it('preserves search, folding, descendant scope and scroll while focus changes, and locates only on request', () => {
  const view = render(<ConnectedSidebar layout={paperLayout('one')} />);
  fireEvent.change(view.getByRole('textbox', { name: '搜索标签或论文' }), { target: { value: '跨论文' } });
  fireEvent.click(view.getByRole('button', { name: '收起标签选择' }));
  fireEvent.click(view.getByRole('button', { name: '包含子标签' }));
  const viewport = view.container.querySelector<HTMLElement>('[data-sidebar-panel="论文"] [data-slot="scroll-area-viewport"]')!;
  viewport.scrollTop = 160;
  view.rerender(<ConnectedSidebar layout={paperLayout('two')} />);
  expect((view.getByRole('textbox', { name: '搜索标签或论文' }) as HTMLInputElement).value).toBe('跨论文');
  expect(view.getByRole('button', { name: '展开标签选择' })).toBeTruthy();
  expect(view.getByRole('button', { name: '包含子标签' }).getAttribute('aria-pressed')).toBe('false');
  expect(view.container.querySelector('[data-sidebar-panel="论文"] [data-slot="scroll-area-viewport"]')).toBe(viewport);
  expect(viewport.scrollTop).toBe(160);
  expect(view.queryByRole('button', { name: /^另一主题论文 / })).toBeNull();
  expect(view.getByRole('button', { name: /^跨论文需求对齐 / }).hasAttribute('aria-current')).toBe(false);
  const locate = view.getByRole('button', { name: '定位当前论文' });
  expect(locate.title).toContain('不在此范围');
  fireEvent.click(locate);
  expect((view.getByRole('textbox', { name: '搜索标签或论文' }) as HTMLInputElement).value).toBe('');
  expect(view.getByRole('button', { name: /^另一主题论文 / }).getAttribute('aria-current')).toBe('page');
  expect(view.getByRole('button', { name: '展开标签选择' })).toBeTruthy();
  expect(props.onRead).not.toHaveBeenCalled();
});

it('clears a hiding search on explicit locate without changing a valid scope or descendant preference', () => {
  const view = render(<ConnectedSidebar layout={paperLayout('one')} />);
  fireEvent.click(view.getByRole('button', { name: '包含子标签' }));
  fireEvent.change(view.getByRole('textbox', { name: '搜索标签或论文' }), { target: { value: 'not-found' } });
  fireEvent.click(view.getByRole('button', { name: '定位当前论文' }));
  expect(view.getByRole('button', { name: /^跨论文需求对齐 / }).getAttribute('aria-current')).toBe('page');
  expect(view.getByRole('button', { name: '包含子标签' }).getAttribute('aria-pressed')).toBe('false');
});

it.each(['loading', 'error', 'deleted', 'library'] as const)('disables locate for %s context', state => {
  const view = render(<ConnectedSidebar layout={state === 'library' ? initialWorkspaceSurfaceLayout : paperLayout('one')}
    entries={state === 'deleted' ? [] : [entry]} status={state === 'loading' || state === 'error' ? state : 'ready'} />);
  expect(view.getByRole('button', { name: '定位当前论文' }).hasAttribute('disabled')).toBe(true);
});

it('collapses all three independent panels and locates a paper by reopening only its panel', () => {
  const onLocateEntry = vi.fn();
  const view = render(<TooltipProvider><SameTagSidebar {...props} currentEntryId="one" onLocateEntry={onLocateEntry} onOpenTagNote={vi.fn()} /></TooltipProvider>);
  expect(view.container.querySelectorAll('[data-sidebar-panel]')).toHaveLength(3);
  const papers = view.getByRole('button', { name: '论文 · 1' });
  const notes = view.getByRole('button', { name: '标签笔记' });
  fireEvent.keyDown(papers, { key: 'ArrowLeft' });
  fireEvent.keyDown(notes, { key: 'ArrowLeft' });
  fireEvent.keyDown(view.getByRole('button', { name: '收起标签选择' }), { key: 'ArrowLeft' });
  expect(papers.getAttribute('aria-expanded')).toBe('false');
  expect(notes.getAttribute('aria-expanded')).toBe('false');
  expect(view.queryByRole('button', { name: /^跨论文需求对齐 / })).toBeNull();
  expect(view.queryByRole('button', { name: '打开标签 软件工程' })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '定位当前论文' }));
  expect(papers.getAttribute('aria-expanded')).toBe('true');
  expect(notes.getAttribute('aria-expanded')).toBe('false');
  expect(view.getByRole('button', { name: '展开标签选择' })).toBeTruthy();
  expect(onLocateEntry).not.toHaveBeenCalled();
  fireEvent.keyDown(notes, { key: 'ArrowRight' });
  expect(notes.getAttribute('aria-expanded')).toBe('true');
});
