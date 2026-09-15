// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readTagReading, saveTagReading, type TagReadingResponse, type TagReadingState } from '@/shared/ipc/tagReadingApi';
import { discardSegmentEditorsBeforeClose, hasUnsavedSegmentEditors, saveSegmentEditorsBeforeClose } from '../components/segmentEditorDirtyRegistry';
import { useTagReadingWorkspace } from './useTagReadingWorkspace';

vi.mock('@/shared/ipc/tagReadingApi', () => ({ readTagReading: vi.fn(), saveTagReading: vi.fn() }));
const response = (): TagReadingResponse => ({ state: {
  version: 1, revision: 0, tag_id: 'tag', include_descendants: true, active_entry_id: null, compare_entry_id: null,
  queue_collapsed: false, split_ratio: 0.5, member_states: {}, updated_at: '2026-09-06'
}, members: [{ entry_id: 'a', title: 'A', pdf_available: false, reflow_available: true, preferred_mode: 'reflow', issue: null }] });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(readTagReading).mockResolvedValue(response()); vi.mocked(saveTagReading).mockImplementation(async (_, state) => ({ ...state, revision: state.revision + 1 })); });
afterEach(cleanup);

it('loads parsed-only members without writing until an action', async () => {
  const hook = renderHook(() => useTagReadingWorkspace('root', 'tag', '1'));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.state?.active_entry_id).toBe('a');
  expect(hook.result.current.members[0].preferred_mode).toBe('reflow');
  expect(saveTagReading).not.toHaveBeenCalled();
});

it('keeps failed writes dirty and retries the same revision through the close guard', async () => {
  vi.mocked(saveTagReading).mockRejectedValueOnce(new Error('disk full'));
  const hook = renderHook(() => useTagReadingWorkspace('root', 'tag', '1'));
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  await act(async () => { await hook.result.current.commit((state) => ({ ...state, queue_collapsed: true })); });
  expect(hook.result.current.error).toBe('disk full');
  expect(hook.result.current.state?.queue_collapsed).toBe(false);
  expect(hasUnsavedSegmentEditors('tag-reading:tag')).toBe(true);
  await act(async () => { expect(await saveSegmentEditorsBeforeClose('tag-reading:tag')).toBe(true); });
  expect(hook.result.current.state).toMatchObject({ revision: 1, queue_collapsed: true });
  expect(hasUnsavedSegmentEditors('tag-reading:tag')).toBe(false);
});

it('serializes duplicate actions and waits for an in-flight save before closing', async () => {
  let finish!: (state: TagReadingState) => void;
  vi.mocked(saveTagReading).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const hook = renderHook(() => useTagReadingWorkspace('root', 'tag', '1'));
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  let saved!: Promise<boolean>;
  act(() => { saved = hook.result.current.commit((state) => ({ ...state, queue_collapsed: true })); void hook.result.current.commit((state) => ({ ...state, split_ratio: 0.7 })); });
  expect(saveTagReading).toHaveBeenCalledTimes(1);
  const closing = saveSegmentEditorsBeforeClose('tag-reading:tag');
  await act(async () => { finish({ ...vi.mocked(saveTagReading).mock.calls[0][1], revision: 1 }); await saved; expect(await closing).toBe(true); });
});

it('retains loaded data on refresh failure and does not replace a dirty draft', async () => {
  const hook = renderHook(() => useTagReadingWorkspace('root', 'tag', '1'));
  await waitFor(() => expect(hook.result.current.state).not.toBeNull());
  vi.mocked(readTagReading).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { await hook.result.current.reload(); });
  expect(hook.result.current.members).toHaveLength(1);
  vi.mocked(saveTagReading).mockRejectedValueOnce(new Error('conflict'));
  await act(async () => { await hook.result.current.commit((state) => ({ ...state, queue_collapsed: true })); await hook.result.current.reload(); });
  expect(readTagReading).toHaveBeenCalledTimes(2);
  act(() => discardSegmentEditorsBeforeClose('tag-reading:tag'));
  vi.mocked(readTagReading).mockResolvedValue(response());
  await act(async () => { await hook.result.current.reload(true); });
  expect(hook.result.current.state?.queue_collapsed).toBe(false);
});

it('ignores late loads after unmount without writing default state', async () => {
  let finish!: (value: TagReadingResponse) => void;
  vi.mocked(readTagReading).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const hook = renderHook(() => useTagReadingWorkspace('root', 'tag', '1'));
  hook.unmount();
  await act(async () => finish(response()));
  expect(saveTagReading).not.toHaveBeenCalled();
  expect(hasUnsavedSegmentEditors('tag-reading:tag')).toBe(false);
});
