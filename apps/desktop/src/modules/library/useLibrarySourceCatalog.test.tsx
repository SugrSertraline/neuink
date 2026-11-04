// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EntryMeta } from '@/shared/types/domain';
import type { EntrySourceInfo } from '@/shared/ipc/workspaceApi';
import { useLibrarySourceCatalog } from './useLibrarySourceCatalog';

const api = vi.hoisted(() => ({ list: vi.fn(), setHidden: vi.fn() }));
vi.mock('@/shared/ipc/workspaceApi', () => ({ listEntrySources: api.list, setEntrySourceHidden: api.setHidden }));
const entries: EntryMeta[] = [];
const visible: Record<string, EntrySourceInfo> = { paper: { kinds: ['zotero'], zotero_hidden: false, zotero_note_ids: ['note'] } };
beforeEach(() => { vi.resetAllMocks(); api.list.mockResolvedValue(visible); api.setHidden.mockResolvedValue({ hidden: true }); });
afterEach(cleanup);

it('keeps a successful hide when an earlier catalog read finishes late', async () => {
  const view = renderHook(() => useLibrarySourceCatalog('workspace', entries));
  await waitFor(() => expect(view.result.current.sources.paper).toBeTruthy());
  let finish!: (value: typeof visible) => void;
  api.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => view.result.current.reload?.());
  await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  await act(async () => { await view.result.current.setHidden('paper', true); });
  await act(async () => { finish(visible); });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(view.result.current.sources.paper.zotero_hidden).toBe(true);
  expect(view.result.current.sources.paper.zotero_note_ids).toEqual(['note']);
});

it('loads persisted hidden state after reopening, restores it, and retains state when saving fails', async () => {
  api.list.mockResolvedValue({ paper: { ...visible.paper, zotero_hidden: true } });
  const view = renderHook(() => useLibrarySourceCatalog('workspace', entries));
  await waitFor(() => expect(view.result.current.sources.paper?.zotero_hidden).toBe(true));
  await act(async () => { await view.result.current.setHidden('paper', false); });
  expect(api.setHidden).toHaveBeenCalledWith('workspace', 'paper', false);
  expect(view.result.current.sources.paper.zotero_hidden).toBe(false);
  api.setHidden.mockRejectedValueOnce(new Error('保存失败'));
  await act(async () => { await expect(view.result.current.setHidden('paper', true)).rejects.toThrow('保存失败'); });
  expect(view.result.current.sources.paper.zotero_hidden).toBe(false);
});
