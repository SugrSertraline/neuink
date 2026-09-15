// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readOwnedNote, setTagNoteDeleted } from '@/shared/ipc/noteOwnerApi';
import type { CatalogNote } from '@/shared/ipc/noteCatalogApi';
import { hasUnsavedMarkdownNote, saveMarkdownNoteBeforeClose } from './editor/noteDirtyRegistry';
import { useWorkspaceNotes } from './WorkspaceNotesContext';
import { useTagNoteActions } from './useTagNoteActions';

vi.mock('./WorkspaceNotesContext', () => ({ useWorkspaceNotes: vi.fn() }));
vi.mock('@/shared/ipc/noteOwnerApi', () => ({ createOwnedNote: vi.fn(), readOwnedNote: vi.fn(), setTagNoteDeleted: vi.fn() }));
vi.mock('./editor/noteDirtyRegistry', () => ({ hasUnsavedMarkdownNote: vi.fn(), saveMarkdownNoteBeforeClose: vi.fn() }));
const note: CatalogNote = { target: { owner: { kind: 'tag_reading', tag_id: 'software' }, note_id: 'draft' }, title: '草稿',
  owner_title: '软件工程', updated_at: '', deleted_at: null, revision: 'old', links: [], error: null };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWorkspaceNotes).mockReturnValue({ root: 'root', catalog: { notes: [note], errors: [] }, loading: false, error: null, refresh: vi.fn(), version: '1' });
  vi.mocked(hasUnsavedMarkdownNote).mockReturnValue(true);
});
afterEach(cleanup);

it('saves unsaved edits and deletes using the new revision, not the stale catalog revision', async () => {
  vi.mocked(saveMarkdownNoteBeforeClose).mockResolvedValue(true);
  vi.mocked(readOwnedNote).mockResolvedValue({ note_id: 'draft', title: '草稿', markdown: 'saved', links: [], revision: 'new' });
  vi.mocked(setTagNoteDeleted).mockResolvedValue(undefined);
  const { result } = renderHook(() => useTagNoteActions('paper/tag-notes'));
  act(() => result.current.setDeleted(note, true));
  await waitFor(() => expect(setTagNoteDeleted).toHaveBeenCalledWith('root', 'software', 'draft', true, 'new'));
  expect(readOwnedNote).toHaveBeenCalledWith('root', note.target);
});

it('keeps the note when unsaved edits cannot be persisted', async () => {
  vi.mocked(saveMarkdownNoteBeforeClose).mockResolvedValue(false);
  const { result } = renderHook(() => useTagNoteActions('paper/tag-notes'));
  act(() => result.current.setDeleted(note, true));
  await waitFor(() => expect(result.current.error).toContain('未保存'));
  expect(setTagNoteDeleted).not.toHaveBeenCalled();
});
