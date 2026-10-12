// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelectionTranslationSettings } from './SelectionTranslationSettings';
import { getSelectionTranslationSettings, saveSelectionTranslationSettings, testSelectionTranslationService } from '@/shared/ipc/selectionTranslationApi';
import { hasUnsavedSegmentEditors } from '@/modules/reader/components/segmentEditorDirtyRegistry';
vi.mock('@/shared/ipc/selectionTranslationApi', () => ({ getSelectionTranslationSettings: vi.fn(), saveSelectionTranslationSettings: vi.fn(), testSelectionTranslationService: vi.fn() }));
const saved = { provider: 'qwen_mt' as const, endpoint: 'https://example.org/v1/chat/completions', model: 'qwen-mt-flash', region: '', has_key: true };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSelectionTranslationSettings).mockResolvedValue(saved);
  vi.mocked(saveSelectionTranslationSettings).mockImplementation(async request => ({ ...request, has_key: true }));
  vi.mocked(testSelectionTranslationService).mockResolvedValue('实验成功了。');
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

it('does not load hidden settings and preserves an edited draft across tab switches', async () => {
  const view = render(<SelectionTranslationSettings active={false} />);
  expect(getSelectionTranslationSettings).not.toHaveBeenCalled();
  view.rerender(<SelectionTranslationSettings active />);
  const model = await screen.findByLabelText('翻译模型名称');
  fireEvent.change(model, { target: { value: 'qwen-mt-lite' } });
  expect(hasUnsavedSegmentEditors('settings')).toBe(true);
  view.rerender(<SelectionTranslationSettings active={false} />);
  view.rerender(<SelectionTranslationSettings active />);
  expect((screen.getByLabelText('翻译模型名称') as HTMLInputElement).value).toBe('qwen-mt-lite');
  fireEvent.click(screen.getByText('放弃修改'));
  expect((screen.getByLabelText('翻译模型名称') as HTMLInputElement).value).toBe(saved.model);
  expect(saveSelectionTranslationSettings).not.toHaveBeenCalled();
});
it('tests the draft without saving and clears a typed key on endpoint changes', async () => {
  render(<SelectionTranslationSettings active />);
  await screen.findByLabelText('翻译模型名称');
  const key = screen.getByLabelText(/API Key/);
  fireEvent.change(key, { target: { value: 'secret-test-key' } });
  fireEvent.click(screen.getByText('测试翻译'));
  await screen.findByText('测试译文：实验成功了。');
  expect(testSelectionTranslationService).toHaveBeenCalledWith(expect.objectContaining({ api_key: 'secret-test-key', provider: 'qwen_mt' }));
  expect(saveSelectionTranslationSettings).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('完整请求地址'), { target: { value: 'https://other.example/translate' } });
  expect((key as HTMLInputElement).value).toBe('');
  expect(screen.queryByText('测试译文：实验成功了。')).toBeNull();
});
it('keeps failed saves editable and saves explicit changes only once while busy', async () => {
  vi.mocked(saveSelectionTranslationSettings).mockRejectedValueOnce('保存翻译密钥失败');
  render(<SelectionTranslationSettings active />);
  fireEvent.change(await screen.findByLabelText('翻译模型名称'), { target: { value: 'qwen-mt-lite' } });
  fireEvent.click(screen.getByText('保存选区翻译设置'));
  await screen.findByRole('alert');
  expect(hasUnsavedSegmentEditors('settings')).toBe(true);
  const button = screen.getByText('保存选区翻译设置');
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(screen.queryByText('保存选区翻译设置')).toBeNull());
  expect(saveSelectionTranslationSettings).toHaveBeenCalledTimes(2);
  expect(hasUnsavedSegmentEditors('settings')).toBe(false);
});
it('offers a retry after loading fails without enabling an uninitialized configuration', async () => {
  vi.mocked(getSelectionTranslationSettings).mockRejectedValueOnce('failure');
  render(<SelectionTranslationSettings active />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(screen.getByText('重新读取配置'));
  await screen.findByRole('combobox');
});
