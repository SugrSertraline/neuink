// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TranslationSourcesSettings } from './TranslationSourcesSettings';
import { DEFAULT_TRANSLATION_ROUTING, getTranslationRouting, saveTranslationRouting } from '@/shared/ipc/translationRoutingApi';
import { hasUnsavedSegmentEditors } from '@/modules/reader/components/segmentEditorDirtyRegistry';
vi.mock('@/shared/ipc/translationRoutingApi', async original => ({ ...await original<typeof import('@/shared/ipc/translationRoutingApi')>(), getTranslationRouting: vi.fn(), saveTranslationRouting: vi.fn() }));
const props = { active: true, profiles: [{ id: 'fast', name: '快速模型', model: 'fast' }, { id: 'precise', name: '精细模型', model: 'precise' }], defaultProfileId: 'fast' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTranslationRouting).mockResolvedValue(DEFAULT_TRANSLATION_ROUTING);
  vi.mocked(saveTranslationRouting).mockImplementation(async value => value);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('sets a default service without overwriting individual scenarios or requiring a model', async () => {
  render(<TranslationSourcesSettings {...props} profiles={[]} defaultProfileId={null} unavailable />);
  fireEvent.keyDown(await screen.findByRole('combobox', { name: '默认翻译来源' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '小牛翻译' }));
  const service = { kind: 'service', provider: 'niutrans' };
  await waitFor(() => expect(saveTranslationRouting).toHaveBeenCalledWith({
    ...DEFAULT_TRANSLATION_ROUTING, default_source: service,
  }));
});

it('keeps the five sources separate and saves a keyboard-selected model', async () => {
  render(<TranslationSourcesSettings {...props} />);
  const select = await screen.findByRole('combobox', { name: '段落逐句对照来源' });
  expect(screen.getAllByRole('combobox')).toHaveLength(6);
  fireEvent.keyDown(select, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '精细模型 · precise' }));
  await waitFor(() => expect(saveTranslationRouting).toHaveBeenCalledWith({ ...DEFAULT_TRANSLATION_ROUTING, paragraph: { kind: 'profile', profile_id: 'precise' } }));
  fireEvent.keyDown(select, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '跟随默认来源 · 快速模型 · fast' }));
  await waitFor(() => expect(saveTranslationRouting).toHaveBeenLastCalledWith(DEFAULT_TRANSLATION_ROUTING));
});
it('preserves a failed draft across tab changes and retries without clearing other sources', async () => {
  vi.mocked(saveTranslationRouting).mockRejectedValueOnce(new Error('failed'));
  const ui = render(<TranslationSourcesSettings {...props} />);
  fireEvent.click(await screen.findByRole('switch', { name: '单词优先使用本地词库' }));
  await screen.findByRole('button', { name: '重试保存翻译来源' });
  expect(hasUnsavedSegmentEditors('settings')).toBe(true);
  ui.rerender(<TranslationSourcesSettings {...props} active={false} />);
  ui.rerender(<TranslationSourcesSettings {...props} />);
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '重试保存翻译来源' }));
  await waitFor(() => expect(hasUnsavedSegmentEditors('settings')).toBe(false));
  expect(saveTranslationRouting).toHaveBeenLastCalledWith({ ...DEFAULT_TRANSLATION_ROUTING, local_dictionary_first: false });
});
it('loads only when active and exposes loading errors without applying defaults', async () => {
  vi.mocked(getTranslationRouting).mockRejectedValueOnce(new Error('failed'));
  const ui = render(<TranslationSourcesSettings {...props} active={false} />);
  expect(getTranslationRouting).not.toHaveBeenCalled();
  ui.rerender(<TranslationSourcesSettings {...props} />);
  await screen.findByText('读取翻译来源失败，请重试。');
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(saveTranslationRouting).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新读取翻译来源' }));
  await screen.findByRole('combobox', { name: '整篇与批量来源' });
});
