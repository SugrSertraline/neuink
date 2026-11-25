// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OtherSourceImportPage } from './OtherSourceImportPage';

const api = vi.hoisted(() => ({
  getMineruSettings: vi.fn(), scanMineru: vi.fn(), importMineruItem: vi.fn(), cancelMineruSearch: vi.fn(async () => {}),
  onMineruSettingsChanged: vi.fn(() => () => {}),
  getZoteroSettings: vi.fn(), scanZotero: vi.fn(), importZoteroPaper: vi.fn(), onZoteroSettingsChanged: vi.fn(() => () => {}),
}));
vi.mock('@/shared/ipc/mineruApi', () => api);
vi.mock('@/shared/ipc/zoteroApi', () => api);
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('./ImportPdfPreview', () => ({ ImportPdfPreview: ({ title, onClose }: { title: string; onClose: () => void }) => <aside aria-label="PDF 预览">{title}<button onClick={onClose}>关闭预览</button></aside> }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getZoteroSettings.mockResolvedValue({ data_directory: 'C:\\Zotero', linked_attachment_directory: null });
  api.scanZotero.mockResolvedValue({ snapshot_id: 'zotero-snapshot', existing: {}, library: { collections: [], papers: [] } });
  api.getMineruSettings.mockResolvedValue({ results_directory: 'C:\\MinerU' });
  api.scanMineru.mockResolvedValue({ snapshot_id: 'mineru-snapshot', items: [
    { id: 'paper', title: 'Local paper', path: `C:\\MinerU\\${'long title '.repeat(30)}`, kind: 'directory', has_pdf: true },
  ] });
});
afterEach(cleanup);

it('removes disabled import sources and explains when both are off', async () => {
  const view = render(<OtherSourceImportPage root="workspace" enabledSources={{ zotero: false, mineru: true }} />);
  await screen.findByText('Local paper');
  expect(screen.queryByRole('tab', { name: 'Zotero' })).toBeNull();
  expect(api.scanZotero).not.toHaveBeenCalled();
  view.rerender(<OtherSourceImportPage root="workspace" enabledSources={{ zotero: false, mineru: false }} />);
  expect(screen.getByRole('status').textContent).toContain('请在设置中启用来源');
  expect(screen.queryByRole('tab', { name: 'MinerU' })).toBeNull();
});

it('switches internally without remounting panels or losing selection, filters and scroll', async () => {
  render(<OtherSourceImportPage root="workspace" />);
  await screen.findByText('此资料库没有可导入的文献。');
  const zoteroPanel = screen.getByRole('tabpanel');
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'MinerU' }), { button: 0, ctrlKey: false });
  await screen.findByText('Local paper');
  const mineruPanel = screen.getByRole('tabpanel');
  const input = screen.getByLabelText('搜索 MinerU 结果');
  fireEvent.change(input, { target: { value: 'Local' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 Local paper' }));
  const scroll = mineruPanel.querySelector('.search-result-scrollbar')!;
  scroll.scrollTop = 120;
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Zotero' }), { button: 0, ctrlKey: false });
  expect(screen.getByRole('tabpanel')).toBe(zoteroPanel);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'MinerU' }), { button: 0, ctrlKey: false });
  expect(screen.getByRole('tabpanel')).toBe(mineruPanel);
  expect((input as HTMLInputElement).value).toBe('Local');
  expect(screen.getByRole('checkbox', { name: '选择 Local paper' }).getAttribute('aria-checked')).toBe('true');
  expect(scroll.scrollTop).toBe(120);
  expect(api.scanMineru).toHaveBeenCalledTimes(2);
  expect(api.scanZotero).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('previews without importing or changing the selected rows', async () => {
  render(<OtherSourceImportPage root="workspace" />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'MinerU' }), { button: 0, ctrlKey: false });
  await screen.findByText('Local paper');
  fireEvent.click(screen.getByRole('button', { name: '预览 PDF' }));
  const preview = await screen.findByRole('complementary', { name: 'PDF 预览' });
  expect(within(preview).getByText('Local paper')).toBeTruthy();
  expect(api.importMineruItem).not.toHaveBeenCalled();
  expect(api.importZoteroPaper).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox', { name: '选择 Local paper' }).getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
  await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
});

it('opens the requested source and follows a later menu request without losing the other panel', async () => {
  const view = render(<OtherSourceImportPage root="workspace" requestedSource="mineru" sourceRequestId="1" />);
  await screen.findByText('Local paper');
  expect(screen.getByRole('tab', { name: 'MinerU' }).getAttribute('aria-selected')).toBe('true');
  view.rerender(<OtherSourceImportPage root="workspace" requestedSource="zotero" sourceRequestId="2" />);
  await screen.findByText('此资料库没有可导入的文献。');
  expect(screen.getByRole('tab', { name: 'Zotero' }).getAttribute('aria-selected')).toBe('true');
  expect(api.scanMineru).toHaveBeenCalledTimes(1);
});
