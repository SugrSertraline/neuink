// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibrarySourceSync } from './useLibrarySourceSync';
import { getLocalBackgroundJobs } from '@/shared/lib/localBackgroundJobs';

const api = vi.hoisted(() => ({
  getZoteroSettings: vi.fn(), scanZotero: vi.fn(), importZoteroPaper: vi.fn(),
  getMineruSettings: vi.fn(), scanMineru: vi.fn(), importMineruItem: vi.fn(),
  onZoteroSettingsChanged: vi.fn(() => () => undefined), onMineruSettingsChanged: vi.fn(() => () => undefined),
}));
vi.mock('@/shared/ipc/zoteroApi', () => ({
  getZoteroSettings: api.getZoteroSettings, scanZotero: api.scanZotero,
  importZoteroPaper: api.importZoteroPaper, onZoteroSettingsChanged: api.onZoteroSettingsChanged,
}));
vi.mock('@/shared/ipc/mineruApi', () => ({
  getMineruSettings: api.getMineruSettings, scanMineru: api.scanMineru,
  importMineruItem: api.importMineruItem, onMineruSettingsChanged: api.onMineruSettingsChanged,
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  api.getZoteroSettings.mockResolvedValue({ data_directory: 'Zotero', linked_attachment_directory: null });
  api.getMineruSettings.mockResolvedValue({ results_directory: 'MinerU' });
  api.scanZotero.mockResolvedValue({ snapshot_id: 'z-snapshot', existing: {}, hidden: ['hidden'], changed: [], library: { papers: [
    { id: 'visible', title: 'Visible', attachments: [{ key: 'pdf', available: true }] },
    { id: 'hidden', title: 'Hidden', attachments: [] },
  ] } });
  api.importZoteroPaper.mockResolvedValue({ status: 'imported' });
  api.scanMineru.mockResolvedValue({ snapshot_id: 'm-snapshot', existing: {}, changed: [], truncated: false, items: [{ id: 'parsed', title: 'Parsed', has_pdf: true }] });
  api.importMineruItem.mockResolvedValue({ status: 'imported' });
});

describe('library source synchronization', () => {
  it('reports reading, completion and failure in the shared task registry', async () => {
    let finish!: (value: unknown) => void;
    api.getMineruSettings.mockResolvedValue({ results_directory: null });
    api.scanZotero.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refreshEntries = vi.fn(async () => undefined);
    const view = renderHook(() => useLibrarySourceSync('task-registry-library', true, refreshEntries));
    const latest = () => getLocalBackgroundJobs().find(job => job.scope?.root === 'task-registry-library');
    await waitFor(() => expect(latest()?.message).toBe('正在检查 Zotero'));
    expect(latest()?.status).toBe('processing');
    await act(async () => finish({ existing: {}, changed: [], library: { papers: [] } }));
    await waitFor(() => expect(latest()?.status).toBe('succeeded'));
    api.scanZotero.mockRejectedValueOnce(new Error('read failed'));
    act(() => view.result.current.refresh());
    await waitFor(() => expect(latest()?.status).toBe('failed'));
    expect(view.result.current.error).toContain('Zotero');
    view.unmount();
  });
  it('keeps local source management enabled without a configured scan directory', async () => {
    api.getZoteroSettings.mockResolvedValue({ enabled: true, data_directory: null });
    api.getMineruSettings.mockResolvedValue({ enabled: true, results_directory: null });
    const refreshEntries = vi.fn(async () => undefined);
    const view = renderHook(() => useLibrarySourceSync('workspace', true, refreshEntries));
    await waitFor(() => expect(view.result.current.scanVersion).toBe(1));
    expect(view.result.current.enabledSources).toEqual({ zotero: true, mineru: true });
    expect(api.scanZotero).not.toHaveBeenCalled();
    expect(api.scanMineru).not.toHaveBeenCalled();
  });
  it('refreshes cached source information even when no new paper is imported', async () => {
    api.getMineruSettings.mockResolvedValue({ results_directory: null });
    api.scanZotero.mockResolvedValue({ snapshot_id: 'snapshot', existing: {}, changed: [], organization_updated: true, library: { papers: [] } });
    const refreshEntries = vi.fn(async () => undefined);
    const view = renderHook(() => useLibrarySourceSync('workspace', true, refreshEntries));
    await waitFor(() => expect(view.result.current.scanVersion).toBe(1));
    expect(refreshEntries).toHaveBeenCalledOnce();
    expect(api.importZoteroPaper).not.toHaveBeenCalled();
  });
  it('does not scan or import disabled sources even when their directories remain configured', async () => {
    api.getZoteroSettings.mockResolvedValue({ enabled: false, data_directory: 'Zotero' });
    api.getMineruSettings.mockResolvedValue({ enabled: false, results_directory: 'MinerU' });
    const refreshEntries = vi.fn(async () => undefined);
    const view = renderHook(() => useLibrarySourceSync('workspace', true, refreshEntries));
    await waitFor(() => expect(view.result.current.scanVersion).toBe(1));
    expect(view.result.current.enabledSources).toEqual({ zotero: false, mineru: false });
    expect(api.scanZotero).not.toHaveBeenCalled();
    expect(api.scanMineru).not.toHaveBeenCalled();
    expect(refreshEntries).not.toHaveBeenCalled();
  });

  it('copies configured sources into the unified library, including hidden Zotero records', async () => {
    const refreshEntries = vi.fn(async () => undefined);
    const view = renderHook(() => useLibrarySourceSync('workspace', true, refreshEntries));
    await waitFor(() => { expect(view.result.current.running).toBe(false); expect(view.result.current.imported).toBe(3); });
    expect(api.importZoteroPaper).toHaveBeenCalledWith('workspace', 'z-snapshot', 'visible', 'pdf', undefined, true);
    expect(api.importZoteroPaper).toHaveBeenCalledWith('workspace', 'z-snapshot', 'hidden', null, undefined, true);
    expect(api.importMineruItem).toHaveBeenCalledWith('workspace', 'm-snapshot', 'parsed');
    expect(api.scanMineru).toHaveBeenCalledWith('workspace', expect.stringMatching(/^library-sync-/), true);
    expect(refreshEntries).toHaveBeenCalledTimes(2);
  });

  it('refreshes the library after Zotero-only imports and reports changed sources', async () => {
    api.getMineruSettings.mockResolvedValue({ results_directory: null });
    api.scanZotero.mockResolvedValue({ snapshot_id: 'z-snapshot', existing: { updated: 'local-entry' }, changed: ['updated'], fingerprints: { updated: 'new-content-hash' }, library: { papers: [
      { id: 'updated', title: 'Updated', fields: {}, tags: [], attachments: [] },
      { id: 'new', title: 'New', attachments: [] },
    ] } });
    const refreshEntries = vi.fn(async () => undefined);
    const view = renderHook(() => useLibrarySourceSync('workspace', true, refreshEntries));
    await waitFor(() => expect(view.result.current.running).toBe(false));
    expect(refreshEntries).toHaveBeenCalledTimes(1);
    expect(view.result.current.changedEntryIds).toEqual(['local-entry']);
    expect(view.result.current.changes).toEqual([{ source: 'zotero', entryId: 'local-entry', sourceId: 'updated', fingerprint: 'new-content-hash', sourceTitle: 'Updated', sourceFields: {}, sourceTags: [], sourcePdfName: null }]);
    act(() => view.result.current.acknowledge(view.result.current.changes[0]));
    expect(view.result.current.changes).toEqual([]);
    view.result.current.refresh();
    await waitFor(() => expect(view.result.current.scanVersion).toBe(2));
    expect(view.result.current.changes).toEqual([]);
    api.scanZotero.mockResolvedValueOnce({ snapshot_id: 'z-new', existing: { updated: 'local-entry' }, changed: ['updated'], fingerprints: { updated: 'later-content-hash' }, library: { papers: [
      { id: 'updated', title: 'Updated again', fields: {}, tags: [], attachments: [] },
    ] } });
    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.scanVersion).toBe(3));
    expect(view.result.current.changes).toHaveLength(1);
  });

  it('reports disappeared source results without deleting local entries', async () => {
    api.getZoteroSettings.mockResolvedValue({ data_directory: null });
    api.scanMineru.mockResolvedValue({ snapshot_id: 'm-snapshot', existing: { 'old-result': 'local-entry' }, changed: [], truncated: false, items: [] });
    const refreshEntries = vi.fn(async () => undefined);
    const view = renderHook(() => useLibrarySourceSync('workspace', true, refreshEntries));
    await waitFor(() => expect(view.result.current.scanVersion).toBe(1));
    expect(view.result.current.issues).toEqual([{ source: 'mineru', title: 'old-result', entryId: 'local-entry', reason: '来源结果已不在当前 MinerU 目录；已保存的来源缓存仍保留。' }]);
    expect(api.importMineruItem).not.toHaveBeenCalled();
    expect(refreshEntries).not.toHaveBeenCalled();
  });
});
