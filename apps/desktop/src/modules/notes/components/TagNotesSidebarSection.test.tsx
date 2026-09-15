// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createOwnedNote, setTagNoteDeleted } from '@/shared/ipc/noteOwnerApi';
import type { CatalogNote } from '@/shared/ipc/noteCatalogApi';
import type { TagMeta } from '@/shared/types/domain';
import { useWorkspaceNotes } from '../WorkspaceNotesContext';
import { TagNotesSidebarSection } from './TagNotesSidebarSection';
import { CreateTagNoteDialog } from './CreateTagNoteDialog';

vi.mock('../WorkspaceNotesContext', () => ({ useWorkspaceNotes: vi.fn() }));
vi.mock('@/shared/ipc/noteOwnerApi', () => ({ createOwnedNote: vi.fn(), setTagNoteDeleted: vi.fn(), readOwnedNote: vi.fn() }));
const tags: TagMeta[] = [
  { id: 'parent', name: '软件工程', parent_id: null, created_at: '', updated_at: '' },
  { id: 'child', name: '需求分析', parent_id: 'parent', created_at: '', updated_at: '' },
  { id: 'other', name: '人机交互', parent_id: null, created_at: '', updated_at: '' }
];
const note = (id: string, tagId: string): CatalogNote => ({ target: { owner: { kind: 'tag_reading', tag_id: tagId }, note_id: id }, title: id,
  owner_title: tagId, updated_at: '', deleted_at: null, revision: '1', links: [], error: null });
const notes = [note('主题比较', 'parent'), note('下级笔记', 'child'), note('其他主题', 'other'), { ...note('已删除', 'parent'), deleted_at: 'now' }, note('失效归属', 'deleted')];
const model = () => ({ root: 'workspace', catalog: { notes, errors: [] }, loading: false, error: null, refresh: vi.fn(), version: '1' });
const props = { tags, tagId: 'parent' as string | null, descendants: true, contextKey: 'workspace', status: 'ready' as const, activeTarget: null, onOpen: vi.fn() };
const renderSection = (changes: Partial<Parameters<typeof TagNotesSidebarSection>[0]> = {}) => render(<TooltipProvider><TagNotesSidebarSection {...props} {...changes} /></TooltipProvider>);
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(useWorkspaceNotes).mockReturnValue(model());
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shows scoped notes below a collapsible header, excludes trash and uses real note owners', () => {
  const view = renderSection({ activeTarget: notes[0].target });
  expect(view.getByRole('button', { name: '标签笔记 · 2' })).toBeTruthy();
  expect(view.getByText('下级笔记')).toBeTruthy();
  expect(view.queryByText('其他主题')).toBeNull();
  expect(view.queryByText('已删除')).toBeNull();
  expect(view.queryByText('失效归属')).toBeNull();
  const row = view.getByRole('button', { name: /^主题比较 软件工程/ });
  expect(row.getAttribute('aria-current')).toBe('page');
  fireEvent.click(row);
  expect(props.onOpen).toHaveBeenCalledWith(notes[0].target, '主题比较');
  props.onOpen.mockClear();
  fireEvent.click(view.getByRole('button', { name: '分屏打开 主题比较' }));
  expect(props.onOpen).toHaveBeenCalledExactlyOnceWith(notes[0].target, '主题比较', true);
  expect(view.container.querySelector('.overflow-y-auto')).toBeNull();
  expect(view.queryByRole('button', { name: '刷新' })).toBeNull();
  view.rerender(<TooltipProvider><TagNotesSidebarSection {...props} descendants={false} /></TooltipProvider>);
  expect(view.queryByText('下级笔记')).toBeNull();
  view.rerender(<TooltipProvider><TagNotesSidebarSection {...props} tagId={null} /></TooltipProvider>);
  expect(view.getByText('其他主题')).toBeTruthy();
});
it('preserves search and collapse across active-note changes, but clears search on explicit scope changes', () => {
  const view = renderSection();
  fireEvent.click(view.getByRole('button', { name: '筛选标签笔记' }));
  fireEvent.change(view.getByRole('textbox', { name: '搜索标签笔记' }), { target: { value: '主题比较' } });
  fireEvent.keyDown(view.getByRole('textbox', { name: '搜索标签笔记' }), { key: 'Escape' });
  fireEvent.click(view.getByRole('button', { name: '标签笔记 · 1' }));
  view.rerender(<TooltipProvider><TagNotesSidebarSection {...props} activeTarget={notes[1].target} /></TooltipProvider>);
  expect(view.getByRole('button', { name: '标签笔记 · 1' }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(view.getByRole('button', { name: '标签笔记 · 1' }));
  expect(view.getByText('主题比较')).toBeTruthy();
  expect(view.queryByText('下级笔记')).toBeNull();
  view.rerender(<TooltipProvider><TagNotesSidebarSection {...props} tagId="other" /></TooltipProvider>);
  expect(view.getByText('其他主题')).toBeTruthy();
});
it('creates in the original tag after browsing changes and retains a failed draft for retry', async () => {
  vi.mocked(createOwnedNote).mockRejectedValueOnce(new Error('写入失败')).mockResolvedValueOnce({ note_id: 'new', title: '新想法', markdown: '', links: [], revision: '1' });
  const view = renderSection();
  fireEvent.click(view.getByRole('button', { name: '新建标签笔记' }));
  fireEvent.change(view.getByRole('textbox', { name: '笔记标题' }), { target: { value: '新想法' } });
  view.rerender(<TooltipProvider><TagNotesSidebarSection {...props} tagId="other" /></TooltipProvider>);
  expect(view.getByRole('combobox', { name: '笔记所属标签' }).textContent).toContain('软件工程');
  fireEvent.click(view.getByRole('button', { name: '创建并打开' }));
  await waitFor(() => expect(view.getAllByRole('alert').some(node => node.textContent?.includes('写入失败'))).toBe(true));
  expect((view.getByRole('textbox', { name: '笔记标题' }) as HTMLInputElement).value).toBe('新想法');
  fireEvent.click(view.getByRole('button', { name: '创建并打开' }));
  await waitFor(() => expect(props.onOpen).toHaveBeenCalledWith({ owner: { kind: 'tag_reading', tag_id: 'parent' }, note_id: 'new' }, '新想法'));
  expect(createOwnedNote).toHaveBeenLastCalledWith('workspace', { kind: 'tag_reading', tag_id: 'parent' }, '新想法');
});
it('moves a note to trash from its menu without opening it', async () => {
  vi.mocked(setTagNoteDeleted).mockResolvedValue(undefined);
  const view = renderSection();
  fireEvent.keyDown(view.getByRole('button', { name: '笔记操作 主题比较' }), { key: 'ArrowDown' });
  fireEvent.click(view.getByRole('menuitem', { name: '移到回收站' }));
  await waitFor(() => expect(setTagNoteDeleted).toHaveBeenCalledWith('workspace', 'parent', '主题比较', true, '1'));
  expect(props.onOpen).not.toHaveBeenCalled();
});
it.each(['loading', 'error', 'deleted', 'read-only'] as const)('disables creation and stale row actions when %s', state => {
  vi.mocked(useWorkspaceNotes).mockReturnValue({ ...model(), loading: state === 'loading', error: state === 'error' ? '目录读取失败' : null, root: state === 'read-only' ? null : 'workspace' });
  const view = renderSection({ tags: state === 'deleted' ? [] : tags });
  expect(view.getByRole('button', { name: '新建标签笔记' }).hasAttribute('disabled')).toBe(true);
  expect(view.queryByRole('button', { name: /^主题比较 软件工程/ })).toBeNull();
  if (state === 'error') { fireEvent.click(view.getByRole('button', { name: '重试' })); expect(useWorkspaceNotes()?.refresh).toHaveBeenCalled(); }
});
it('keeps source snapshots listed when the original paper was deleted', () => {
  vi.mocked(useWorkspaceNotes).mockReturnValue({ ...model(), catalog: { notes: [{ ...notes[0], source_statuses: [{ entry_id: 'gone', segment_uid: 's', quote_hash: '', status: 'entry_deleted', message: '原论文已删除', can_locate: false }] }], errors: [] } });
  const view = renderSection();
  expect(view.getByRole('button', { name: /主题比较.*含已删除来源/ })).toBeTruthy();
});
it('does not silently assign a different owner when the selected tag disappears in a creation dialog', () => {
  const onCreate = vi.fn();
  const dialogProps = { tags: tags.map(tag => ({ id: tag.id, label: tag.name })), defaultTagId: 'parent', busy: false, error: null, onClose: vi.fn(), onCreate };
  const view = render(<CreateTagNoteDialog {...dialogProps} />);
  fireEvent.change(view.getByRole('textbox', { name: '笔记标题' }), { target: { value: '新笔记' } });
  view.rerender(<CreateTagNoteDialog {...dialogProps} tags={dialogProps.tags.slice(1)} />);
  expect(view.getByRole('button', { name: '创建并打开' }).hasAttribute('disabled')).toBe(true);
  expect(onCreate).not.toHaveBeenCalled();
});
