// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MineruSnapshot } from '@/shared/ipc/mineruApi';
import { MineruImportDialog } from './MineruImportDialog';

const api = vi.hoisted(() => ({
  getMineruSettings: vi.fn(), saveMineruSettings: vi.fn(), discoverMineru: vi.fn(), cancelMineruSearch: vi.fn(),
  scanMineru: vi.fn(), importMineruItem: vi.fn(), onMineruSettingsChanged: vi.fn(() => () => undefined),
}));
const pick = vi.hoisted(() => vi.fn());
const fileManager = vi.hoisted(() => ({ openPathInFileManager: vi.fn() }));
vi.mock('@/shared/ipc/mineruApi', () => api);
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: pick }));
vi.mock('@/shared/ipc/assistantApi', () => fileManager);

const snapshot: MineruSnapshot = {
  snapshot_id: 'snapshot', source_directory: 'C:\\Results', truncated: false,
  items: [
    { id: 'first', path: 'C:\\Results\\first', title: 'First paper', kind: 'directory', has_pdf: true },
    { id: 'second', path: 'C:\\Results\\second.zip', title: 'Second paper', kind: 'zip', has_pdf: true },
    { id: 'missing', path: 'C:\\Results\\missing.rar', title: 'Missing PDF', kind: 'rar', has_pdf: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getMineruSettings.mockResolvedValue({ results_directory: 'C:\\Results' });
  api.scanMineru.mockResolvedValue(structuredClone(snapshot));
  api.importMineruItem.mockImplementation(async (_root, _snapshot, id) => ({ status: 'imported', entry_id: `entry-${id}`, title: id }));
  api.cancelMineruSearch.mockResolvedValue(undefined);
  fileManager.openPathInFileManager.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('MinerU local import', () => {
  it('reads the configured directory automatically and imports only selected results with PDFs', async () => {
    const refreshed = vi.fn();
    render(<MineruImportDialog root="workspace" onClose={vi.fn()} onImported={refreshed} />);
    await screen.findByText('First paper');
    expect(api.scanMineru).toHaveBeenCalledTimes(1);
    expect(api.importMineruItem).not.toHaveBeenCalled();
    expect((screen.getByRole('checkbox', { name: '选择 Missing PDF' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 First paper' }));
    fireEvent.click(screen.getByRole('button', { name: '导入所选' }));
    await screen.findByText('本批导入已结束。');
    expect(api.importMineruItem.mock.calls).toEqual([['workspace', 'snapshot', 'first']]);
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it('finds one local source without importing, then loads its list', async () => {
    api.getMineruSettings.mockResolvedValue({ results_directory: null });
    api.discoverMineru.mockResolvedValue([{ results_directory: 'D:\\MinerU', count: 2, truncated: false }]);
    api.saveMineruSettings.mockResolvedValue({ results_directory: 'D:\\MinerU' });
    render(<MineruImportDialog root="workspace" onClose={vi.fn()} />);
    await screen.findByText('First paper');
    expect(api.saveMineruSettings).toHaveBeenCalledWith({ results_directory: 'D:\\MinerU' });
    expect(api.importMineruItem).not.toHaveBeenCalled();
  });

  it('discards a late result list after selecting another directory', async () => {
    let finishOld!: (value: MineruSnapshot) => void;
    api.scanMineru.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const newer = structuredClone(snapshot);
    newer.snapshot_id = 'new';
    newer.items[0].title = 'New source paper';
    api.scanMineru.mockResolvedValueOnce(newer);
    render(<MineruImportDialog root="workspace" onClose={vi.fn()} />);
    await waitFor(() => expect(api.scanMineru).toHaveBeenCalledTimes(1));
    pick.mockResolvedValue('D:\\Other');
    api.saveMineruSettings.mockResolvedValue({ results_directory: 'D:\\Other' });
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }));
    await screen.findByText('New source paper');
    expect(api.cancelMineruSearch).toHaveBeenCalledWith(api.scanMineru.mock.calls[0][1]);
    await act(async () => { finishOld(structuredClone(snapshot)); });
    expect(screen.queryByText('First paper')).toBeNull();
  });

  it('opens the source folder and hides the Windows extended path prefix', async () => {
    const current = structuredClone(snapshot);
    current.items[0].path = '\\\\?\\C:\\Results\\first';
    api.scanMineru.mockResolvedValueOnce(current);
    render(<MineruImportDialog root="workspace" onClose={vi.fn()} />);
    const openFolder = await screen.findByRole('button', { name: '打开 First paper 的结果目录' });
    expect(openFolder.textContent).toBe('打开目录');
    expect(screen.getByTitle('C:\\Results\\first').className).toContain('truncate');
    fireEvent.click(openFolder);
    await waitFor(() => expect(fileManager.openPathInFileManager).toHaveBeenCalledWith(current.items[0].path));
  });

  it('lets a manual directory choice interrupt an ongoing automatic search', async () => {
    api.getMineruSettings.mockResolvedValue({ results_directory: null });
    let finishSearch!: (value: unknown) => void;
    api.discoverMineru.mockImplementationOnce(() => new Promise(resolve => { finishSearch = resolve; }));
    pick.mockResolvedValue('D:\\Manual');
    api.saveMineruSettings.mockResolvedValue({ results_directory: 'D:\\Manual' });
    render(<MineruImportDialog root="workspace" onClose={vi.fn()} />);
    await screen.findByText(/正在查找常见目录/);
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }));
    await screen.findByDisplayValue('D:\\Manual');
    expect(api.cancelMineruSearch).toHaveBeenCalledWith(api.discoverMineru.mock.calls[0][0]);
    await act(async () => { finishSearch([{ results_directory: 'D:\\Old', count: 1, truncated: false }]); });
    expect(screen.getByDisplayValue('D:\\Manual')).toBeTruthy();
    expect(api.saveMineruSettings).toHaveBeenCalledTimes(1);
  });
});
