// @vitest-environment jsdom
import { cleanup, fireEvent, render as renderDom, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { createOwnedNote, setTagNoteDeleted } from '@/shared/ipc/noteOwnerApi';
import type { CatalogNote } from '@/shared/ipc/noteCatalogApi';
import type { TagMeta } from '@/shared/types/domain';
import { useWorkspaceNotes } from '../WorkspaceNotesContext';
import { EntryTagNotesSidebar } from './EntryTagNotesSidebar';
import { TagNotesList } from './TagNotesList';
import { CreateTagNoteButton } from './CreateTagNoteButton';

vi.mock('../WorkspaceNotesContext', () => ({ useWorkspaceNotes: vi.fn() }));
const render = (ui: Parameters<typeof renderDom>[0]) => renderDom(ui, { wrapper: TooltipProvider });
vi.mock('@/shared/ipc/noteOwnerApi', () => ({ createOwnedNote: vi.fn(), setTagNoteDeleted: vi.fn(), readOwnedNote: vi.fn() }));
const entry: LibraryEntry = { id: 'paper', title: '论文 A', tagIds: ['child'], tags: ['软件工程/需求'], contents: [], fields: {},
  createdAt: '', updatedAt: '', pdfFileName: null, parseMessage: null, parseEndpoint: null, status: 'No PDF', progress: 0 };
const tags: TagMeta[] = [
  { id: 'software', name: '软件工程', parent_id: null, created_at: '', updated_at: '' },
  { id: 'child', name: '需求', parent_id: 'software', created_at: '', updated_at: '' },
  { id: 'other', name: '其他研究', parent_id: null, created_at: '', updated_at: '' }
];
const row = (title: string, owner: string, cited = false): CatalogNote => ({ title,
  target: { owner: { kind: 'tag_reading', tag_id: owner }, note_id: title }, owner_title: owner,
  updated_at: '', deleted_at: null, error: null, revision: '1',
  links: cited ? [{ link_id: title, anchor_id: title, display_text: '来源', owner: { kind: 'tag_note', tag_id: owner, note_id: title }, created_at: '',
    sources: [{ entry_id: 'paper', segment_uid: 's', page: 1, snapshot_text: '证据', quote_hash: '' }] }] : [] });
const notes = [row('跨论文比较', 'software', true), row('没有来源的想法', 'software'), row('其他标签引用', 'other', true), row('子标签笔记', 'child')];
const refresh = vi.fn();
const model = () => ({ root: 'workspace', catalog: { notes, errors: [] }, loading: false, error: null, refresh, version: '1' });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWorkspaceNotes).mockReturnValue(model());
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('flat tag notes in entry details', () => {
  it('creates from the library header in the correct tag and retains the form after failure', async () => {
    const onOpen = vi.fn();
    vi.mocked(createOwnedNote).mockRejectedValueOnce(new Error('写入失败')).mockResolvedValueOnce({ note_id: 'header-note', title: '研究对比', markdown: '', links: [], revision: '1' });
    const view = render(<CreateTagNoteButton tagId="child" tagLabel="软件工程 / 需求" scope="library/tag:child" onOpen={onOpen} />);
    fireEvent.click(view.getByRole('button', { name: '新建笔记' }));
    expect(view.getByRole('combobox', { name: '笔记所属标签' }).textContent).toContain('软件工程 / 需求');
    fireEvent.change(view.getByRole('textbox', { name: '笔记标题' }), { target: { value: '研究对比' } });
    fireEvent.click(view.getByRole('button', { name: '创建并打开' }));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('写入失败'));
    expect((view.getByRole('textbox', { name: '笔记标题' }) as HTMLInputElement).value).toBe('研究对比');
    fireEvent.click(view.getByRole('button', { name: '创建并打开' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ owner: { kind: 'tag_reading', tag_id: 'child' }, note_id: 'header-note' }, '研究对比'));
    expect(createOwnedNote).toHaveBeenLastCalledWith('workspace', { kind: 'tag_reading', tag_id: 'child' }, '研究对比');
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('disables header creation when the workspace is unavailable and offers retry only for catalog errors', () => {
    vi.mocked(useWorkspaceNotes).mockReturnValue({ ...model(), error: '读取失败' });
    const view = render(<><CreateTagNoteButton tagId="software" scope="library/tag:software" /><TagNotesList tagId="software" scope="library/tag:software" hideCreateAction /></>);
    expect((view.getByRole('button', { name: '新建笔记' }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.queryByRole('button', { name: '刷新' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '重试' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('shows related notes as a plain list, excludes trash and opens the real owner', () => {
    const onOpen = vi.fn();
    const current = model();
    current.catalog.notes = [...notes, { ...row('已删除想法', 'software'), deleted_at: 'now' }];
    vi.mocked(useWorkspaceNotes).mockReturnValue(current);
    const view = render(<EntryTagNotesSidebar entry={entry} tags={tags} contextTagId="software" scope="overview:paper" activeTarget={notes[0].target} onOpen={onOpen} />);
    for (const note of notes) expect(view.getByText(note.title)).toBeTruthy();
    expect(view.queryByText('已删除想法')).toBeNull();
    expect(view.queryByRole('combobox')).toBeNull();
    expect(view.queryByRole('textbox')).toBeNull();
    expect(view.queryByRole('button', { name: '已删除笔记' })).toBeNull();
    expect(view.queryByRole('button', { name: '刷新' })).toBeNull();
    const button = view.getByRole('button', { name: /^跨论文比较 标签笔记/ });
    expect(button.getAttribute('aria-current')).toBe('page');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(notes[0].target, notes[0].title);
    onOpen.mockClear();
    fireEvent.click(view.getByRole('button', { name: '分屏打开 跨论文比较' }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(notes[0].target, notes[0].title, true);
  });

  it('offers search and full tag paths in a filter popover, with explicit citation filtering', () => {
    const view = render(<EntryTagNotesSidebar entry={entry} tags={tags} contextTagId="software" scope="overview:paper" onOpen={vi.fn()} />);
    fireEvent.click(view.getByRole('button', { name: '筛选标签笔记' }));
    fireEvent.keyDown(view.getByRole('combobox', { name: '标签笔记范围' }), { key: 'ArrowDown' });
    expect(view.getByRole('option', { name: '软件工程/需求' })).toBeTruthy();
    fireEvent.click(view.getByRole('option', { name: '仅引用本论文' }));
    expect(view.getByText('其他标签引用')).toBeTruthy();
    expect(view.queryByText('没有来源的想法')).toBeNull();
    fireEvent.change(view.getByRole('textbox', { name: '搜索标签笔记' }), { target: { value: '其他' } });
    expect(view.queryByText('跨论文比较')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: /^清除筛选$/ }));
    expect(view.getByText('没有来源的想法')).toBeTruthy();
  });

  it('preserves filtering when the section is collapsed and uses no nested scrolling', () => {
    const view = render(<EntryTagNotesSidebar entry={entry} tags={tags} scope="overview:paper" onOpen={vi.fn()} />);
    fireEvent.click(view.getByRole('button', { name: '筛选标签笔记' }));
    fireEvent.change(view.getByRole('textbox', { name: '搜索标签笔记' }), { target: { value: '想法' } });
    fireEvent.keyDown(view.getByRole('textbox', { name: '搜索标签笔记' }), { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: /标签笔记 · 1/ }));
    expect(view.queryByRole('button', { name: /^没有来源的想法 标签笔记/ })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: /标签笔记 · 1/ }));
    expect(view.getByRole('button', { name: /^没有来源的想法 标签笔记/ })).toBeTruthy();
    expect(view.container.querySelector('.overflow-y-auto')).toBeNull();
  });

  it('creates in the chosen tag and deletes without opening the row', async () => {
    const onOpen = vi.fn();
    vi.mocked(createOwnedNote).mockResolvedValue({ note_id: 'new', title: '新想法', markdown: '', links: [], revision: '2' });
    vi.mocked(setTagNoteDeleted).mockResolvedValue(undefined);
    const view = render(<EntryTagNotesSidebar entry={entry} tags={tags} contextTagId="software" scope="overview:paper" onOpen={onOpen} />);
    fireEvent.click(view.getByRole('button', { name: '新建标签笔记' }));
    expect(view.getByRole('combobox', { name: '笔记所属标签' }).textContent).toContain('软件工程');
    fireEvent.change(view.getByRole('textbox', { name: '笔记标题' }), { target: { value: '新想法' } });
    fireEvent.click(view.getByRole('button', { name: '创建并打开' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ owner: { kind: 'tag_reading', tag_id: 'software' }, note_id: 'new' }, '新想法'));
    expect(createOwnedNote).toHaveBeenCalledWith('workspace', { kind: 'tag_reading', tag_id: 'software' }, '新想法');
    onOpen.mockClear();
    fireEvent.click(view.getByRole('button', { name: '删除标签笔记 跨论文比较' }));
    await waitFor(() => expect(setTagNoteDeleted).toHaveBeenCalledWith('workspace', 'software', '跨论文比较', true, '1'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('recovers tag notes in the trash without offering a second normal-list trash toggle', async () => {
    const current = model();
    current.catalog.notes = [...notes, { ...row('回收站中的笔记', 'software'), deleted_at: 'now' }];
    vi.mocked(useWorkspaceNotes).mockReturnValue(current);
    const view = render(<TagNotesList deletedOnly embedded scope="library/trash-tag-notes" />);
    expect(view.queryByText('跨论文比较')).toBeNull();
    expect((view.getByRole('button', { name: /回收站中的笔记/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.queryByRole('button', { name: '新建笔记' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(setTagNoteDeleted).toHaveBeenCalledWith('workspace', 'software', '回收站中的笔记', false, '1'));
  });

  it('distinguishes loading, failure and empty states without enabling invalid creation', () => {
    vi.mocked(useWorkspaceNotes).mockReturnValue({ ...model(), loading: true, catalog: { notes: [], errors: [] } });
    const props = { entry: { ...entry, tagIds: [] }, tags, scope: 'overview:paper', onOpen: vi.fn() };
    const view = render(<EntryTagNotesSidebar {...props} />);
    expect(view.getByRole('status').textContent).toContain('正在读取');
    expect(view.queryByText('暂无相关标签笔记')).toBeNull();
    expect((view.getByRole('button', { name: '新建标签笔记' }) as HTMLButtonElement).disabled).toBe(true);
    vi.mocked(useWorkspaceNotes).mockReturnValue({ ...model(), loading: false, catalog: { notes: [], errors: [] }, error: '读取失败' });
    view.rerender(<EntryTagNotesSidebar {...props} />);
    expect(view.getByRole('alert').textContent).toContain('读取失败');
    fireEvent.click(view.getByRole('button', { name: '重试' }));
    expect(refresh).toHaveBeenCalled();
    vi.mocked(useWorkspaceNotes).mockReturnValue({ ...model(), catalog: { notes: [], errors: [] } });
    view.rerender(<EntryTagNotesSidebar {...props} />);
    expect(view.getByText('暂无相关标签笔记')).toBeTruthy();
    expect((view.getByRole('button', { name: '新建标签笔记' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
