// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SelectionTranslationSettings } from './SelectionTranslationSettings';
import { getTranslationServices, saveTranslationService, testSelectionTranslationService } from '@/shared/ipc/selectionTranslationApi';
import { hasUnsavedSegmentEditors, listUnsavedEditors } from '@/modules/reader/components/segmentEditorDirtyRegistry';
vi.mock('@/shared/ipc/selectionTranslationApi', () => ({ getTranslationServices: vi.fn(), saveTranslationService: vi.fn(), testSelectionTranslationService: vi.fn() }));
const saved = { provider: 'qwen_mt' as const, endpoint: 'https://example.org/v1/chat/completions', model: 'qwen-mt-flash', region: '', has_key: true };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTranslationServices).mockResolvedValue([saved]);
  vi.mocked(saveTranslationService).mockImplementation(async request => ({ ...request, has_key: true }));
  vi.mocked(testSelectionTranslationService).mockResolvedValue('实验成功了。');
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
async function openService(name = '通义 Qwen-MT') {
  const title = await screen.findByText(name, { selector: 'summary span' });
  const details = title.closest('details')!;
  fireEvent.click(details.querySelector('summary')!);
  return details;
}

it('does not load hidden settings and preserves an edited draft across tab switches', async () => {
  const view = render(<SelectionTranslationSettings active={false} />);
  expect(getTranslationServices).not.toHaveBeenCalled();
  view.rerender(<SelectionTranslationSettings active />);
  await openService();
  const model = await screen.findByLabelText('翻译模型名称');
  fireEvent.change(model, { target: { value: 'qwen-mt-lite' } });
  expect(hasUnsavedSegmentEditors('settings')).toBe(true);
  view.rerender(<SelectionTranslationSettings active={false} />);
  view.rerender(<SelectionTranslationSettings active />);
  expect((screen.getByLabelText('翻译模型名称') as HTMLInputElement).value).toBe('qwen-mt-lite');
  fireEvent.click(screen.getByText('放弃修改'));
  expect((screen.getByLabelText('翻译模型名称') as HTMLInputElement).value).toBe(saved.model);
  expect(saveTranslationService).not.toHaveBeenCalled();
});
it('tests the draft without saving and clears a typed key on endpoint changes', async () => {
  render(<SelectionTranslationSettings active />);
  await openService();
  await screen.findByLabelText('翻译模型名称');
  const key = screen.getByLabelText(/API Key/);
  fireEvent.change(key, { target: { value: 'secret-test-key' } });
  fireEvent.click(screen.getByText('测试翻译'));
  await screen.findByText('测试译文：实验成功了。');
  expect(testSelectionTranslationService).toHaveBeenCalledWith(expect.objectContaining({ api_key: 'secret-test-key', provider: 'qwen_mt' }));
  expect(saveTranslationService).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('完整请求地址'), { target: { value: 'https://other.example/translate' } });
  expect((key as HTMLInputElement).value).toBe('');
  expect(screen.queryByText('测试译文：实验成功了。')).toBeNull();
});
it('keeps failed saves editable and saves explicit changes only once while busy', async () => {
  vi.mocked(saveTranslationService).mockRejectedValueOnce('保存翻译密钥失败');
  render(<SelectionTranslationSettings active />);
  await openService();
  fireEvent.change(await screen.findByLabelText('翻译模型名称'), { target: { value: 'qwen-mt-lite' } });
  fireEvent.click(screen.getByText('验证并保存'));
  await screen.findByRole('alert');
  expect(hasUnsavedSegmentEditors('settings')).toBe(true);
  const button = screen.getByText('验证并保存');
  fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(screen.queryByText('验证并保存')).toBeNull());
  expect(saveTranslationService).toHaveBeenCalledTimes(2);
  expect(hasUnsavedSegmentEditors('settings')).toBe(false);
});
it('offers a retry after loading fails without enabling an uninitialized configuration', async () => {
  vi.mocked(getTranslationServices).mockRejectedValueOnce('failure');
  render(<SelectionTranslationSettings active />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('combobox')).toBeNull();
  fireEvent.click(screen.getByText('重新读取配置'));
  await screen.findByLabelText('翻译模型名称');
});

it('keeps service keys independent and only saves after a successful validation', async () => {
  vi.mocked(getTranslationServices).mockResolvedValue([
    { provider: 'niutrans', endpoint: 'https://api.niutrans.com/NiuTransServer/translation', model: '', region: '', has_key: false }, saved,
  ]);
  render(<SelectionTranslationSettings active />);
  const niu = await openService('小牛翻译');
  const qwen = await openService();
  const key = within(niu).getByLabelText('API Key');
  fireEvent.change(key, { target: { value: 'niu-test' } });
  fireEvent.change(within(qwen).getByLabelText('翻译模型名称'), { target: { value: 'qwen-mt-lite' } });
  vi.mocked(testSelectionTranslationService).mockRejectedValueOnce('API Key 无效');
  fireEvent.click(within(niu).getByText('验证并保存'));
  await within(niu).findByRole('alert');
  expect(saveTranslationService).not.toHaveBeenCalled();
  expect((key as HTMLInputElement).value).toBe('niu-test');
  fireEvent.click(within(niu).getByText('验证并保存'));
  await within(niu).findByText(/验证成功/);
  expect(saveTranslationService).toHaveBeenCalledWith(expect.objectContaining({ provider: 'niutrans', api_key: 'niu-test' }));
  expect((within(qwen).getByLabelText('翻译模型名称') as HTMLInputElement).value).toBe('qwen-mt-lite');
  expect(hasUnsavedSegmentEditors('settings')).toBe(true);
});

it('keeps collapsed drafts registered and opens the exact form when an unsaved edit is revealed', async () => {
  vi.mocked(getTranslationServices).mockResolvedValue([
    { provider: 'niutrans', endpoint: 'https://api.niutrans.com/NiuTransServer/translation', model: '', region: '', has_key: false }, saved,
  ]);
  render(<SelectionTranslationSettings active />);
  const title = await screen.findByText('小牛翻译', { selector: 'summary span' });
  const niu = title.closest('details')!;
  const qwen = screen.getByText('通义 Qwen-MT', { selector: 'summary span' }).closest('details')!;
  expect(niu.open).toBe(false); expect(qwen.open).toBe(false);
  fireEvent.click(niu.querySelector('summary')!);
  const key = within(niu).getByLabelText('API Key') as HTMLInputElement;
  fireEvent.change(key, { target: { value: 'fixture-secret' } });
  fireEvent.click(niu.querySelector('summary')!);
  expect(niu.open).toBe(false);
  expect(niu.querySelector('summary')?.textContent).toContain('未保存');
  const record = listUnsavedEditors().find(editor => editor.handler?.label?.().includes('小牛'))!;
  expect(record).toBeDefined();
  act(() => record.handler?.reveal?.());
  await waitFor(() => expect(document.activeElement).toBe(key));
  expect(niu.open).toBe(true); expect(qwen.open).toBe(false);
  expect(key.value).toBe('fixture-secret');
  expect(saveTranslationService).not.toHaveBeenCalled();
  expect(testSelectionTranslationService).not.toHaveBeenCalled();
});
