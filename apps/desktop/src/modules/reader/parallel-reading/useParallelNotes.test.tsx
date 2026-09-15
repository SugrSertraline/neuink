// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteTarget, SourceLink } from '@/shared/types/domain';
import { useParallelNotes } from './useParallelNotes';
const api = vi.hoisted(() => ({ listTagNotes: vi.fn(), createOwnedNote: vi.fn(), readOwnedNote: vi.fn(), saveOwnedNote: vi.fn(), buildOwnedNoteSourceLink: vi.fn(), setTagNoteDeleted: vi.fn() }));
vi.mock('@/shared/ipc/noteOwnerApi', () => api);
const target: NoteTarget = { owner: { kind: 'tag_reading', tag_id: 'tag' }, note_id: 'note' };
const options = () => ({ root: 'root', tagId: 'tag', tagTitle: '主题', entries: [], memberIds: [], target: null as NoteTarget | null, open: false, refreshKey: '1', onSaveEntryNote: vi.fn(), onRefreshEntries: vi.fn() });
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); api.listTagNotes.mockResolvedValue([]); });
describe('parallel note model', () => {
  it('does not create a note just for opening the workspace or picker', async () => {
    const props = options(); const hook = renderHook((value) => useParallelNotes(value), { initialProps: props });
    expect(api.listTagNotes).not.toHaveBeenCalled();
    hook.rerender({ ...props, open: true });
    await waitFor(() => expect(api.listTagNotes).toHaveBeenCalledOnce());
    expect(api.createOwnedNote).not.toHaveBeenCalled();
  });
  it('queues all source insertions instead of overwriting the previous pending link', async () => {
    const links = [{ link_id: 'one' }, { link_id: 'two' }] as SourceLink[];
    api.buildOwnedNoteSourceLink.mockResolvedValueOnce(links[0]).mockResolvedValueOnce(links[1]);
    const hook = renderHook(() => useParallelNotes({ ...options(), target }));
    await act(async () => hook.result.current.setWritable(true));
    await act(async () => { await hook.result.current.addSource('paper-a', 's1'); await hook.result.current.addSource('paper-b', 's2'); });
    expect(hook.result.current.pending?.link_id).toBe('one');
    act(() => hook.result.current.inserted(links[0]));
    expect(hook.result.current.pending?.link_id).toBe('two');
    act(() => hook.result.current.inserted(links[1]));
    expect(hook.result.current.pending).toBeNull();
  });
  it('rejects read-only insertion and discards late responses for a different target', async () => {
    const props = { ...options(), target };
    const hook = renderHook((value) => useParallelNotes(value), { initialProps: props });
    await expect(hook.result.current.addSource('a', 's')).rejects.toThrow('可编辑');
    let resolve!: (link: SourceLink) => void;
    api.buildOwnedNoteSourceLink.mockReturnValue(new Promise((done) => { resolve = done; }));
    await act(async () => hook.result.current.setWritable(true));
    const request = hook.result.current.addSource('a', 's');
    const checked = expect(request).rejects.toThrow('目标笔记已切换');
    hook.rerender({ ...props, target: { ...target, note_id: 'other' } });
    await act(async () => { resolve({ link_id: 'late' } as SourceLink); await checked; });
    expect(hook.result.current.pending).toBeNull();
  });
  it('surfaces backend errors without presenting an empty saved list as success', async () => {
    api.listTagNotes.mockRejectedValue(new Error('无法读取文件'));
    const hook = renderHook(() => useParallelNotes({ ...options(), open: true }));
    await waitFor(() => expect(hook.result.current.error).toContain('无法读取文件'));
    expect(hook.result.current.loading).toBe(false);
  });
  it('deduplicates optimistic creations when the refreshed tag list arrives', async () => {
    const note = { note_id: 'created', title: 'New', markdown: '', links: [], revision: '1' };
    api.createOwnedNote.mockResolvedValue(note);
    const hook = renderHook(() => useParallelNotes({ ...options(), open: true }));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    api.listTagNotes.mockResolvedValue([{ ...note, updated_at: 'now', deleted_at: null }]);
    await act(async () => { await hook.result.current.create(target.owner, 'New'); });
    await waitFor(() => expect(hook.result.current.options).toHaveLength(1));
    expect(hook.result.current.options[0].revision).toBe('1');
  });
});
