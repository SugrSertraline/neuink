// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { listReadingStates } from '@/shared/ipc/workspaceApi';
import { emitReadingStateUpdated } from '@/shared/lib/readingStateEvents';
import type { EntryReadingState } from '@/shared/types/domain';
import { useLibraryReadingStates } from './useLibraryReadingStates';

vi.mock('@/shared/ipc/workspaceApi', () => ({ listReadingStates: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const state: EntryReadingState = { entry_id: 'paper', version: 1, document_hash: null, mode: 'pdf', current_page_idx: 1, page_count: 10, visited_pages: [0, 1], total_active_ms: 1000, session_count: 1, last_read_at: null, daily_active_ms: {} };
it('does not overwrite a live reading update with an older initial snapshot', async () => {
  let resolve!: (states: EntryReadingState[]) => void;
  vi.mocked(listReadingStates).mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useLibraryReadingStates('root'));
  act(() => emitReadingStateUpdated({ ...state, current_page_idx: 5 }));
  await act(async () => resolve([state]));
  expect(view.result.current.states.paper.current_page_idx).toBe(5);
  expect(view.result.current.loading).toBe(false);
});
it('clears old workspace progress and ignores its delayed response after switching roots', async () => {
  let resolveOld!: (states: EntryReadingState[]) => void;
  vi.mocked(listReadingStates).mockImplementationOnce(() => new Promise(done => { resolveOld = done; })).mockResolvedValueOnce([]);
  const view = renderHook(({ root }) => useLibraryReadingStates(root), { initialProps: { root: 'old' } });
  view.rerender({ root: 'new' });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () => resolveOld([state]));
  expect(view.result.current.states).toEqual({});
});
