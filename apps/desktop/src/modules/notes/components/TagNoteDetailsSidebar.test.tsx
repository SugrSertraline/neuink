// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { initialWorkspaceSurfaceLayout, noteSurface } from '@/app/workspaceSurface';
import type { CatalogNote } from '@/shared/ipc/noteCatalogApi';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { useWorkspaceNotes } from '../WorkspaceNotesContext';
import { TagNoteDetailsSidebar } from './TagNoteDetailsSidebar';

vi.mock('../WorkspaceNotesContext', () => ({ useWorkspaceNotes: vi.fn() }));
vi.mock('@/modules/reader/useLibraryReadingStates', () => ({ useLibraryReadingStates: () => ({ states: {}, loading: false, error: false }) }));
const entry: LibraryEntry = { id: 'paper', title: '来源论文甲', tagIds: ['tag'], tags: ['软件工程'], contents: [], fields: {}, createdAt: '', updatedAt: '', pdfFileName: 'paper.pdf', status: 'Parsed', progress: 100, parseMessage: null, parseEndpoint: null };
const note: CatalogNote = { target: { owner: { kind: 'tag_reading', tag_id: 'tag' }, note_id: 'note' }, title: '研究比较', owner_title: '软件工程', updated_at: '', deleted_at: null, error: null, revision: '1',
  links: [{ link_id: 'link', anchor_id: 'a', owner: { kind: 'tag_note', tag_id: 'tag', note_id: 'note' }, display_text: '引用', created_at: '', sources: ['paper', 'paper', 'deleted'].map(entry_id => ({ entry_id, segment_uid: 's', page: 1, snapshot_text: '证据', quote_hash: '' })) }],
  source_statuses: [{ entry_id: 'deleted', segment_uid: 's', quote_hash: '', status: 'entry_deleted', can_locate: false, message: '原论文已删除' }] };
const otherNote = { ...note, title: '同标签的另一笔记', target: { ...note.target, note_id: 'other' }, links: [] };
const model = () => ({ root: 'workspace', loading: false, error: null, version: '1', refresh: vi.fn(), catalog: { notes: [note, otherNote], errors: [] } });
const props = { target: note.target, title: note.title, entries: [entry], tags: [{ id: 'tag', name: '软件工程', parent_id: null, created_at: '', updated_at: '' }],
  status: 'ready' as const, error: null, layout: { ...initialWorkspaceSurfaceLayout, left: noteSurface(note.target) }, onLocateTag: vi.fn(), onRead: vi.fn(), onOpenNote: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(useWorkspaceNotes).mockReturnValue(model()); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const show = (changes: Partial<typeof props> = {}) => render(<TooltipProvider><TagNoteDetailsSidebar {...props} {...changes} /></TooltipProvider>);

it('deduplicates sources, preserves deleted evidence and separates direct from split opening', () => {
  const view = show();
  expect(view.getByRole('complementary', { name: '标签笔记详情' })).toBeTruthy();
  expect(view.getByRole('button', { name: '来源论文 · 2' })).toBeTruthy();
  expect(view.getAllByRole('button', { name: /^来源论文甲 / })).toHaveLength(1);
  expect(view.getByText('原论文已删除')).toBeTruthy();
  expect(view.queryByRole('button', { name: /deleted/ })).toBeNull();
  fireEvent.click(view.getByRole('button', { name: /^来源论文甲 / }));
  expect(props.onRead).toHaveBeenLastCalledWith(entry, false);
  fireEvent.click(view.getByRole('button', { name: '在右侧打开 来源论文甲' }));
  expect(props.onRead).toHaveBeenLastCalledWith(entry, true);
  fireEvent.click(view.getByRole('button', { name: '定位所属标签' }));
  expect(props.onLocateTag).toHaveBeenCalledWith('tag');
});

it('highlights the focused note and exposes collapsible same-tag notes with independent open actions', () => {
  const view = show();
  expect(view.getByRole('button', { name: /^研究比较 软件工程/ }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(view.getByRole('button', { name: /^同标签的另一笔记 软件工程/ }));
  expect(props.onOpenNote).toHaveBeenCalledWith(otherNote.target, otherNote.title);
  fireEvent.click(view.getByRole('button', { name: '同标签笔记 · 2' }));
  expect(view.queryByRole('button', { name: /^同标签的另一笔记 软件工程/ })).toBeNull();
});

it('opens comparison on the left when the note is on the right', () => {
  const view = render(<TooltipProvider><TagNoteDetailsSidebar {...props} layout={{ ...props.layout, left: { kind: 'pdf', entryId: 'paper' }, right: noteSurface(note.target), focusedPane: 'right' }} /></TooltipProvider>);
  const button = view.getByRole('button', { name: '在左侧打开 来源论文甲' });
  expect(button.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(button);
  expect(props.onRead).toHaveBeenCalledWith(entry, true);
});

it.each(['empty', 'loading', 'error', 'deleted', 'missing', 'tag-deleted'] as const)('shows an explicit %s state without stale source actions', state => {
  const data = model();
  vi.mocked(useWorkspaceNotes).mockReturnValue({ ...data, loading: state === 'loading', error: state === 'error' ? '目录读取失败' : null,
    catalog: { notes: state === 'missing' ? [] : [{ ...note, links: state === 'empty' ? [] : note.links, deleted_at: state === 'deleted' ? 'now' : null }], errors: [] } });
  const view = show({ tags: state === 'tag-deleted' ? [] : props.tags });
  expect(view.queryByRole('button', { name: /^来源论文甲 / })).toBeNull();
  if (state === 'empty') expect(view.getByText('尚未关联来源论文')).toBeTruthy();
  if (state === 'tag-deleted') expect(view.queryByRole('button', { name: '定位所属标签' })).toBeNull();
  if (state === 'error') { fireEvent.click(view.getAllByRole('button', { name: '重试' })[0]); expect(data.refresh).toHaveBeenCalled(); }
});
