// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProviderCatalogPicker } from './ProviderCatalogPicker';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  // jsdom has no layout; give the real virtualizer a bounded viewport.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(256);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(416);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('searches providers by Chinese alias and confirms with keyboard', () => {
  const select = vi.fn(); render(<ProviderCatalogPicker catalog={[]} baseUrl="" busy={false} onSelect={select} onCustom={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '搜索模型提供商' }));
  const search = screen.getByRole('combobox', { name: '搜索提供商' });
  fireEvent.change(search, { target: { value: '深度求索' } });
  expect(screen.getByRole('option', { name: /DeepSeek/ })).toBeTruthy();
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'Home', ctrlKey: true });
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ label: 'DeepSeek' }));
  expect(screen.getByRole('combobox', { name: '搜索提供商' }).getAttribute('aria-expanded')).toBe('false');
});
it('keeps custom setup available offline and blocks interactions while busy', () => {
  const custom = vi.fn(); const ui = render(<ProviderCatalogPicker catalog={[]} baseUrl="" busy={false} onSelect={vi.fn()} onCustom={custom} />);
  fireEvent.click(screen.getByRole('button', { name: '搜索模型提供商' }));
  fireEvent.change(screen.getByRole('combobox', { name: '搜索提供商' }), { target: { value: 'unknown-provider' } });
  expect(screen.getByText(/没有匹配的提供商/)).toBeTruthy();
  fireEvent.click(screen.getByRole('option', { name: /自定义提供商/ })); expect(custom).toHaveBeenCalledOnce();
  ui.rerender(<ProviderCatalogPicker catalog={[]} baseUrl="" busy onSelect={vi.fn()} onCustom={custom} />);
  fireEvent.click(screen.getByRole('button', { name: '搜索模型提供商' }));
  expect(screen.getByRole('combobox', { name: '搜索提供商' }).getAttribute('aria-expanded')).toBe('false');
});
it('lets users select providers with incomplete connection metadata instead of disabling them', () => {
  const manual = vi.fn(), select = vi.fn();
  render(<ProviderCatalogPicker catalog={[{ id: 'remote-chat', providerId: 'remote', providerName: 'Remote Demo', providerNpm: '@custom/unknown' }]}
    baseUrl="" busy={false} onSelect={select} onCustom={vi.fn()} onManualSelect={manual} />);
  expect((screen.getByRole('combobox', { name: '搜索提供商' }) as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '搜索模型提供商' }));
  fireEvent.change(screen.getByRole('combobox', { name: '搜索提供商' }), { target: { value: 'Remote Demo' } });
  const row = screen.getByRole('option', { name: /Remote Demo/ });
  expect(row.getAttribute('aria-disabled')).not.toBe('true');
  fireEvent.click(row);
  expect(manual).toHaveBeenCalledWith(expect.objectContaining({ id: 'remote', label: 'Remote Demo', baseUrl: '' }));
  expect(select).not.toHaveBeenCalled();
});
it('owns the nested dialog scroll lock and restores focus and lock on Escape', async () => {
  const select = vi.fn();
  const ui = render(<Dialog open><DialogContent><DialogTitle>连接配置</DialogTitle>
    <ProviderCatalogPicker catalog={[]} baseUrl="" busy={false} onSelect={select} onCustom={vi.fn()} />
  </DialogContent></Dialog>);
  const trigger = screen.getByRole('combobox', { name: '搜索提供商' });
  await waitFor(() => expect(document.body.getAttribute('data-scroll-locked')).toBe('1'));
  fireEvent.focus(trigger);
  // The menu stays inside the existing Dialog scroll lock; focus remains on the original input.
  await waitFor(() => expect(document.body.getAttribute('data-scroll-locked')).toBe('1'));
  const list = screen.getByRole('listbox');
  Object.defineProperties(list, { scrollHeight: { value: 608 }, clientHeight: { value: 256 } });
  list.style.overflowY = 'auto';
  expect(fireEvent.wheel(list, { deltaY: 120, bubbles: true, cancelable: true })).toBe(true);
  fireEvent.keyDown(screen.getByRole('combobox', { name: '搜索提供商' }), { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(document.body.getAttribute('data-scroll-locked')).toBe('1');
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: '连接配置' })).toBeTruthy();
  ui.unmount();
  expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
});
it('virtualizes every provider without an 80-item cap and searches and navigates beyond the mounted range', async () => {
  const manual = vi.fn();
  const catalog = Array.from({ length: 226 }, (_, index) => ({
    id: `model-${index}`, providerId: `remote-${index}`, providerName: `Remote ${String(index).padStart(3, '0')}`,
  }));
  render(<ProviderCatalogPicker catalog={catalog} baseUrl="" busy={false} onSelect={vi.fn()} onCustom={vi.fn()} onManualSelect={manual} />);
  fireEvent.click(screen.getByRole('button', { name: '搜索模型提供商' }));
  expect(screen.getAllByRole('option').length).toBeLessThan(20);
  expect(screen.queryByText(/显示前|缩小搜索范围|切换地址会清空旧密钥/)).toBeNull();
  const list = screen.getByRole('listbox');
  // Scroll into the public providers well beyond the old cap, with real range extraction.
  fireEvent.scroll(list, { target: { scrollTop: 12000 } });
  await waitFor(() => expect(screen.getAllByRole('option').some(row => Number(row.getAttribute('aria-posinset')) > 160)).toBe(true));
  expect(screen.getAllByRole('option').length).toBeLessThan(20);
  const search = screen.getByRole('combobox', { name: '搜索提供商' });
  fireEvent.keyDown(search, { key: 'End', ctrlKey: true });
  fireEvent.keyDown(search, { key: 'ArrowUp' });
  expect(screen.getByRole('option', { name: /Remote 225/ }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(manual).toHaveBeenCalledWith(expect.objectContaining({ id: 'remote-225' }));
  fireEvent.click(screen.getByRole('button', { name: '搜索模型提供商' }));
  fireEvent.change(screen.getByRole('combobox', { name: '搜索提供商' }), { target: { value: 'Remote 225' } });
  fireEvent.click(screen.getByRole('option', { name: /Remote 225/ }));
  expect(manual).toHaveBeenCalledTimes(2);
});
