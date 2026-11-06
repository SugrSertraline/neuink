// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWorkspaceResourceActions } from './useWorkspaceResourceActions';
import type { EntryMeta } from '@/shared/types/domain';

const api = vi.hoisted(() => ({ deleteEntry: vi.fn(async () => undefined) }));
vi.mock('@/shared/ipc/workspaceApi', () => api);
afterEach(cleanup);
it('sequential batch deletes keep every completed removal even when the caller retains an older callback', async () => {
  const initial = ['a', 'b', 'c'].map(id => ({ id, title: id, tags: [], fields: {}, pdf: null, contents: [], created_at: '', updated_at: '' } as EntryMeta));
  const selectFirstEntry = vi.fn();
  const view = renderHook(() => {
    const [entries, setEntries] = useState(initial), [trash, setTrashedEntries] = useState<EntryMeta[]>([]);
    const actions = useWorkspaceResourceActions({ entries, setEntries, setTrashedEntries, root: 'library', tags: [], selectedEntryId: null,
      selectFirstEntry, refreshEntries: vi.fn(async () => undefined), refreshAnnotationCatalog: vi.fn(async () => []), refreshTrashItems: vi.fn(async () => []),
      setError: vi.fn(), setTags: vi.fn(), setSelectedEntryId: vi.fn(), setParseSubmissionCount: vi.fn() });
    return { actions, entries, trash };
  });
  const remove = view.result.current.actions.deleteWorkspaceEntry;
  await act(async () => { await remove('a'); await remove('b'); });
  expect(view.result.current.entries.map(entry => entry.id)).toEqual(['c']);
  expect(view.result.current.trash.map(entry => entry.id).sort()).toEqual(['a', 'b']);
  expect(selectFirstEntry).toHaveBeenLastCalledWith([initial[2]]);
});
