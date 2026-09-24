// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from './useWorkspace';

const api = vi.hoisted(() => ({ openDevWorkspace: vi.fn(), switchWorkspaceRoot: vi.fn(),
  listAnnotations: vi.fn(), listTrashItems: vi.fn(), listEntries: vi.fn(), listTrashedEntries: vi.fn() }));
vi.mock('../ipc/workspaceApi', async original => ({ ...await original<typeof import('../ipc/workspaceApi')>(), ...api }));
vi.mock('../ipc/tagReadingApi', () => ({ listTagArchives: async () => [] }));
vi.mock('./useWorkspaceResourceActions', () => ({ useWorkspaceResourceActions: () => ({}) }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const entry = (id: string) => ({ id, title: id, tags: [], contents: [], fields: {} });
const workspace = (root: string) => ({ root, entries: [entry(root)], tags: [], trashed_entries: [] });
beforeEach(() => {
  vi.resetAllMocks();
  api.openDevWorkspace.mockResolvedValue(workspace('A'));
  api.switchWorkspaceRoot.mockImplementation(async root => workspace(root));
  api.listAnnotations.mockImplementation(async root => [{ id: `annotation-${root}` }]);
  api.listTrashItems.mockImplementation(async root => [{ id: `trash-${root}` }]);
  api.listEntries.mockImplementation(async root => [entry(root)]);
  api.listTrashedEntries.mockResolvedValue([]);
});
afterEach(cleanup);

describe('workspace request ownership', () => {
  it('does not publish old annotations or trash after switching libraries', async () => {
    const annotations = deferred<unknown[]>(), trash = deferred<unknown[]>();
    api.listAnnotations.mockImplementation(root => root === 'A' ? annotations.promise : Promise.resolve([{ id: 'annotation-B' }]));
    api.listTrashItems.mockImplementation(root => root === 'A' ? trash.promise : Promise.resolve([{ id: 'trash-B' }]));
    const { result } = renderHook(useWorkspace);
    await waitFor(() => expect(result.current.root).toBe('A'));
    await act(() => result.current.switchWorkspaceRoot('B'));
    await act(async () => { annotations.resolve([{ id: 'annotation-A' }]); trash.resolve([{ id: 'trash-A' }]); });
    expect(result.current.annotationRecords).toEqual([{ id: 'annotation-B' }]);
    expect(result.current.trashItems).toEqual([{ id: 'trash-B' }]);
  });
  it('does not display an error from an abandoned library', async () => {
    const annotations = deferred<unknown[]>();
    api.listAnnotations.mockImplementation(root => root === 'A' ? annotations.promise : Promise.resolve([]));
    const { result } = renderHook(useWorkspace);
    await waitFor(() => expect(result.current.root).toBe('A'));
    await act(() => result.current.switchWorkspaceRoot('B'));
    await act(async () => annotations.reject(new Error('A is unavailable')));
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('ready');
  });
  it('does not replace current entries with an earlier library refresh', async () => {
    const entries = deferred<unknown[]>();
    const { result } = renderHook(useWorkspace);
    await waitFor(() => expect(result.current.root).toBe('A'));
    api.listEntries.mockReturnValueOnce(entries.promise);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refreshEntries('A'); });
    await act(() => result.current.switchWorkspaceRoot('B'));
    await act(async () => { entries.resolve([entry('old-A')]); await pending; });
    expect(result.current.root).toBe('B');
    expect(result.current.entries.map(value => value.id)).toEqual(['B']);
    expect(result.current.selectedEntryId).toBe('B');
  });
  it('keeps the newest refresh when two reads finish out of order', async () => {
    const entries = deferred<unknown[]>();
    const { result } = renderHook(useWorkspace);
    await waitFor(() => expect(result.current.root).toBe('A'));
    api.listEntries.mockReturnValueOnce(entries.promise).mockResolvedValueOnce([entry('new-A')]);
    let pending!: Promise<void>;
    act(() => { pending = result.current.refreshEntries(); });
    await act(() => result.current.refreshEntries());
    await act(async () => { entries.resolve([entry('stale-A')]); await pending; });
    expect(result.current.entries.map(value => value.id)).toEqual(['new-A']);
  });
  it('keeps the current library and data when opening another library fails', async () => {
    const { result } = renderHook(useWorkspace);
    await waitFor(() => expect(result.current.root).toBe('A'));
    api.switchWorkspaceRoot.mockRejectedValueOnce(new Error('Cannot open B'));
    await act(async () => { await expect(result.current.switchWorkspaceRoot('B')).rejects.toThrow('Cannot open B'); });
    expect(result.current.root).toBe('A');
    expect(result.current.entries.map(value => value.id)).toEqual(['A']);
    expect(result.current.status).toBe('ready');
  });
  it('does not revive a response from a previous visit to the same library', async () => {
    const old = deferred<unknown[]>();
    api.listAnnotations.mockReturnValueOnce(old.promise);
    const { result } = renderHook(useWorkspace);
    await waitFor(() => expect(result.current.root).toBe('A'));
    await act(() => result.current.switchWorkspaceRoot('B'));
    await act(() => result.current.switchWorkspaceRoot('A'));
    await act(async () => old.resolve([{ id: 'old-visit-A' }]));
    expect(result.current.annotationRecords).toEqual([{ id: 'annotation-A' }]);
  });
  it('lets a manual refresh supersede the pending initial catalog reads', async () => {
    const oldAnnotations = deferred<unknown[]>(), oldTrash = deferred<unknown[]>();
    api.listAnnotations.mockReturnValueOnce(oldAnnotations.promise);
    api.listTrashItems.mockReturnValueOnce(oldTrash.promise);
    const { result } = renderHook(useWorkspace);
    await waitFor(() => expect(result.current.root).toBe('A'));
    await act(async () => { await result.current.refreshAnnotationCatalog(); await result.current.refreshTrashItems(); });
    await act(async () => { oldAnnotations.resolve([{ id: 'stale' }]); oldTrash.resolve([{ id: 'stale' }]); });
    expect(result.current.annotationRecords).toEqual([{ id: 'annotation-A' }]);
    expect(result.current.trashItems).toEqual([{ id: 'trash-A' }]);
  });
});
