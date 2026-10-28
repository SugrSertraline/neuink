// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZoteroSnapshot } from '@/shared/ipc/zoteroApi';
import { ZoteroImportDialog } from './ZoteroImportDialog';

const api = vi.hoisted(() => ({ getZoteroSettings: vi.fn(), saveZoteroSettings: vi.fn(), discoverZotero: vi.fn(), scanZotero: vi.fn(), importZoteroPaper: vi.fn(), onZoteroSettingsChanged: vi.fn(() => () => undefined) }));
const pick = vi.hoisted(() => vi.fn());
vi.mock('@/shared/ipc/zoteroApi', () => api);
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: pick }));
const snapshot: ZoteroSnapshot = {
  snapshot_id: 'snapshot', existing: { old: 'local-entry' },
  library: { source_id: 'source', data_directory: 'C:\\Zotero', collections: [], papers: [
    { id: 'old', key: 'OLD', library_id: 1, library_name: '我的文库', title: 'Already imported', authors: 'Ada', year: '2024', fields: {}, tags: [], collection_ids: [], attachments: [] },
    { id: 'alpha', key: 'ALPHA', library_id: 1, library_name: '我的文库', title: 'Alpha paper', authors: 'Alice', year: '2025', fields: { doi: '10.1/alpha' }, tags: ['扩散模型'], collection_ids: [], attachments: [{ key: 'PDF1', file_name: 'Alpha.pdf', available: true, reason: null }] },
    { id: 'beta', key: 'BETA', library_id: 1, library_name: '我的文库', title: 'Beta paper', authors: 'Bob', year: '', fields: {}, tags: [], collection_ids: [], attachments: [{ key: 'PDF2', file_name: 'Beta.pdf', available: false, reason: '附件未下载或文件已移动' }] },
  ] },
};
beforeEach(() => {
  vi.clearAllMocks();
  api.getZoteroSettings.mockResolvedValue({ data_directory: 'C:\\Zotero', linked_attachment_directory: null });
  api.scanZotero.mockResolvedValue(structuredClone(snapshot));
  api.importZoteroPaper.mockImplementation(async (_root, _snapshot, id) => ({ entry_id: `local-${id}`, title: id, status: 'imported', has_pdf: id === 'alpha' }));
});
afterEach(cleanup);

async function openList() {
  const close = vi.fn();
  render(<ZoteroImportDialog root="workspace" onClose={close} />);
  await waitFor(() => expect((screen.getByLabelText('Zotero 数据目录') as HTMLInputElement).value).toBe('C:\\Zotero'));
  await screen.findByText('Alpha paper');
  return close;
}

describe('Zotero selection import', () => {
  it('loads automatically, excludes existing entries and imports only explicit selections', async () => {
    render(<ZoteroImportDialog root="workspace" onClose={vi.fn()} />);
    await screen.findByText('Alpha paper');
    expect(api.scanZotero).toHaveBeenCalledTimes(1); expect(api.importZoteroPaper).not.toHaveBeenCalled();
    expect((screen.getByRole('checkbox', { name: '选择 Already imported' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Alpha paper' }));
    fireEvent.click(screen.getByRole('button', { name: '导入所选' }));
    await screen.findByText('本批导入已结束。');
    expect(api.importZoteroPaper.mock.calls).toEqual([['workspace', 'snapshot', 'alpha', 'PDF1']]);
    expect(screen.getByText(/新增 1/)).toBeTruthy();
  });

  it('searches metadata, limits select-all to results and retains selections across filters', async () => {
    await openList();
    fireEvent.change(screen.getByLabelText('搜索 Zotero 论文'), { target: { value: '扩散模型 2025' } });
    expect(screen.queryByText('Beta paper')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前筛选结果' }));
    fireEvent.change(screen.getByLabelText('搜索 Zotero 论文'), { target: { value: 'Bob' } });
    expect(screen.getByText(/已选 1 篇/).textContent).toContain('包含筛选外条目');
    fireEvent.click(screen.getByRole('button', { name: '导入所选' }));
    await screen.findByText('本批导入已结束。');
    expect(api.importZoteroPaper.mock.calls[0][2]).toBe('alpha');
  });

  it('supports missing PDFs as metadata-only imports and retries failures without repeating success', async () => {
    await openList();
    api.importZoteroPaper.mockImplementationOnce(async () => { throw '文件已移动，请刷新列表。'; });
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前筛选结果' }));
    fireEvent.click(screen.getByRole('button', { name: '导入所选' }));
    await screen.findByText('本批导入已结束。');
    expect(api.importZoteroPaper.mock.calls[1]).toEqual(['workspace', 'snapshot', 'beta', null]);
    expect(screen.getByRole('checkbox', { name: '选择 Alpha paper' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '重试／导入所选' }));
    await waitFor(() => expect(api.importZoteroPaper).toHaveBeenCalledTimes(3));
    expect(api.importZoteroPaper.mock.calls[2][2]).toBe('alpha');
    await waitFor(() => expect(screen.queryByText('文件已移动，请刷新列表。')).toBeNull());
  });

  it('finishes the current paper when stopping, blocks escape while writing, and leaves remaining selections', async () => {
    const close = await openList();
    let finish!: (value: unknown) => void;
    api.importZoteroPaper.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前筛选结果' }));
    fireEvent.click(screen.getByRole('button', { name: '导入所选' }));
    await screen.findByRole('button', { name: '停止导入' });
    fireEvent.keyDown(document, { key: 'Escape' }); expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '停止导入' }));
    await act(async () => { finish({ entry_id: 'local-alpha', status: 'imported', title: 'Alpha', has_pdf: true }); });
    await screen.findByText('导入已停止，已完成的论文保留。');
    expect(api.importZoteroPaper).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('checkbox', { name: '选择 Beta paper' }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows read errors without claiming an empty library and permits a retry', async () => {
    api.scanZotero.mockRejectedValueOnce('资料库忙碌，请稍后重试。');
    render(<ZoteroImportDialog root="workspace" onClose={vi.fn()} />);
    await screen.findByText('资料库忙碌，请稍后重试。');
    expect(screen.queryByText('此资料库没有可导入的文献。')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }));
    await screen.findByText('Alpha paper');
  });

  it('validates and persists a selected directory, then invalidates the previous list', async () => {
    await openList();
    pick.mockResolvedValue('D:\\MyZotero');
    api.saveZoteroSettings.mockResolvedValue({ data_directory: 'D:\\MyZotero', linked_attachment_directory: null });
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }));
    await screen.findByDisplayValue('D:\\MyZotero');
    expect(api.saveZoteroSettings).toHaveBeenCalledWith({ data_directory: 'D:\\MyZotero', linked_attachment_directory: null });
    await waitFor(() => expect(api.scanZotero).toHaveBeenCalledTimes(2));
    expect(api.importZoteroPaper).not.toHaveBeenCalled();
  });

  it('ignores a late list after switching directories', async () => {
    let finishOld!: (value: ZoteroSnapshot) => void;
    api.scanZotero.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const newer = structuredClone(snapshot);
    newer.snapshot_id = 'new';
    newer.library.papers[1].title = 'New source paper';
    api.scanZotero.mockResolvedValueOnce(newer);
    render(<ZoteroImportDialog root="workspace" onClose={vi.fn()} />);
    await waitFor(() => expect(api.scanZotero).toHaveBeenCalledTimes(1));
    pick.mockResolvedValue('D:\\New');
    api.saveZoteroSettings.mockResolvedValue({ data_directory: 'D:\\New', linked_attachment_directory: null });
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }));
    await screen.findByText('New source paper');
    await act(async () => { finishOld(structuredClone(snapshot)); });
    expect(screen.getByText('New source paper')).toBeTruthy();
    expect(screen.queryByText('Alpha paper')).toBeNull();
  });

  it('offers the linked attachment directory only when a relative link cannot be resolved', async () => {
    const unresolved = structuredClone(snapshot);
    unresolved.library.papers[2].attachments[0].reason = '链接附件未找到，请检查基础目录或文件是否已移动';
    api.scanZotero.mockResolvedValueOnce(unresolved);
    await openList();
    expect(screen.getByRole('button', { name: '选择附件目录' })).toBeTruthy();
  });

  it('retains the list and selection when the same directory is chosen again', async () => {
    await openList();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Alpha paper' }));
    pick.mockResolvedValue('C:\\Zotero');
    api.saveZoteroSettings.mockResolvedValue({ data_directory: 'C:\\Zotero', linked_attachment_directory: null });
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }));
    await screen.findByText('目录已保存');
    expect(screen.getByRole('checkbox', { name: '选择 Alpha paper' }).getAttribute('aria-checked')).toBe('true');
    expect(api.scanZotero).toHaveBeenCalledTimes(1);
  });

  it('keeps the current source and selection when a chosen directory is invalid', async () => {
    await openList();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Alpha paper' }));
    pick.mockResolvedValue('D:\\Invalid');
    api.saveZoteroSettings.mockRejectedValueOnce('所选目录中没有 Zotero 数据库。');
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }));
    await screen.findByText('所选目录中没有 Zotero 数据库。');
    expect(screen.getByDisplayValue('C:\\Zotero')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: '选择 Alpha paper' }).getAttribute('aria-checked')).toBe('true');
  });

  it('discovers and saves a single source without importing any paper', async () => {
    api.getZoteroSettings.mockResolvedValue({ data_directory: null, linked_attachment_directory: null });
    const discovered = { data_directory: 'D:\\Found', linked_attachment_directory: 'D:\\Linked' };
    api.discoverZotero.mockResolvedValue([discovered]);
    api.saveZoteroSettings.mockResolvedValue(discovered);
    render(<ZoteroImportDialog root="workspace" onClose={vi.fn()} />);
    await screen.findByDisplayValue('D:\\Found');
    await screen.findByText('Alpha paper');
    expect(screen.queryByDisplayValue('D:\\Linked')).toBeNull();
    expect(api.saveZoteroSettings).toHaveBeenCalledWith(discovered);
    expect(api.scanZotero).toHaveBeenCalledTimes(1);
    expect(api.importZoteroPaper).not.toHaveBeenCalled();
  });

  it('does not arbitrarily select one of multiple discovered libraries', async () => {
    await openList();
    api.discoverZotero.mockResolvedValue([
      { data_directory: 'D:\\First', linked_attachment_directory: null },
      { data_directory: 'D:\\Second', linked_attachment_directory: null },
    ]);
    fireEvent.click(screen.getByRole('button', { name: '自动查找' }));
    await screen.findByText('发现多个资料库，请选择要导入的目录。');
    expect(api.saveZoteroSettings).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('C:\\Zotero')).toBeTruthy();
    expect(screen.getByText('Alpha paper')).toBeTruthy();
  });
});
