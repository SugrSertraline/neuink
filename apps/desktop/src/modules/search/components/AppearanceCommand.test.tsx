// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider, APP_APPEARANCE_STORAGE_KEY } from '@/shared/components/AppearanceProvider';
import { ToastContext } from '@/shared/hooks/useToast';
import { SearchDialog } from './SearchDialog';
import { SearchPanel } from './SearchPanel';

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function renderSearch(panel = false) {
  const close = vi.fn();
  const openSetting = vi.fn();
  render(<AppearanceProvider><ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'theme') }}>
    {panel ? <SearchPanel root={null} status="ready" onOpenResult={vi.fn()} onOpenSetting={openSetting} />
      : <SearchDialog root={null} status="ready" open onOpenChange={close} onOpenResult={vi.fn()} onOpenSetting={openSetting} />}
  </ToastContext.Provider></AppearanceProvider>);
  return { close, openSetting, input: screen.getByRole('combobox', { name: panel ? '搜索资料' : '全局搜索' }) };
}

it.each([false, true])('opens settings without a loaded library and ignores IME Enter (sidebar: %s)', async panel => {
  const { input, openSetting, close } = renderSearch(panel);
  fireEvent.change(input, { target: { value: '预览大小' } });
  await waitFor(() => expect(screen.getByRole('option', { name: /PDF 预览大小/ }).getAttribute('data-selected')).toBe('true'));
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(openSetting).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(openSetting).toHaveBeenCalledWith('reader-preview-size');
  if (!panel) expect(close).toHaveBeenCalledWith(false);
});
describe('the hidden appearance command in real search surfaces', () => {
  it('requires the complete case-insensitive command and an explicit action', () => {
    const { input } = renderSearch();
    expect(screen.queryByRole('option')).toBeNull();
    for (const value of ['the', 'SugrSertraline', '论文']) {
      fireEvent.change(input, { target: { value } });
      expect(screen.queryByText('拟物')).toBeNull();
      expect(screen.queryByText('玻璃')).toBeNull();
    }
    fireEvent.change(input, { target: { value: ' ThEmE ' } });
    expect(screen.getByText('拟物')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(window.localStorage.getItem(APP_APPEARANCE_STORAGE_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /拟物/ }));
    expect(document.documentElement.dataset.appearance).toBe('atelier');
  });
  it('supports keyboard choice before a workspace is ready, ignores IME Enter and closes the dialog', async () => {
    const { input, close } = renderSearch();
    fireEvent.change(input, { target: { value: ' ThEmE ' } });
    fireEvent.keyDown(input, { key: 'End' });
    await waitFor(() => expect(screen.getByRole('option', { name: /玻璃/ }).getAttribute('data-selected')).toBe('true'));
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(document.documentElement.hasAttribute('data-appearance')).toBe(false);
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.documentElement.dataset.appearance).toBe('liquid-glass');
    expect(close).toHaveBeenCalledWith(false);
  });
  it('uses the same reversible command in sidebar search', () => {
    window.localStorage.setItem(APP_APPEARANCE_STORAGE_KEY, 'atelier');
    const { input } = renderSearch(true);
    fireEvent.change(input, { target: { value: ' ThEmE ' } });
    expect(screen.getByRole('option', { name: /拟物/ }).getAttribute('data-checked')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: /标准/ }));
    expect(window.localStorage.getItem(APP_APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute('data-appearance')).toBe(false);
  });
  it('switches from the study to glass in sidebar search and changes transparency without leaving the menu', () => {
    window.localStorage.setItem(APP_APPEARANCE_STORAGE_KEY, 'atelier');
    const { input } = renderSearch(true);
    fireEvent.change(input, { target: { value: ' ThEmE ' } });
    fireEvent.click(screen.getByRole('option', { name: /玻璃/ }));
    expect(document.documentElement.dataset.appearance).toBe('liquid-glass');
    expect(window.localStorage.getItem(APP_APPEARANCE_STORAGE_KEY)).toBe('liquid-glass');
    fireEvent.change(input, { target: { value: ' ThEmE ' } });
    fireEvent.click(screen.getByRole('option', { name: /降低透明度/ }));
    expect(document.documentElement.dataset.glassTransparency).toBe('reduced');
    expect(screen.getByRole('option', { name: /恢复通透效果/ }).getAttribute('data-checked')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: /恢复通透效果/ }));
    expect(document.documentElement.hasAttribute('data-glass-transparency')).toBe(false);
    fireEvent.click(screen.getByRole('option', { name: /拟物/ }));
    expect(document.documentElement.dataset.appearance).toBe('atelier');
    expect(document.documentElement.hasAttribute('data-glass-transparency')).toBe(false);
  });
});
