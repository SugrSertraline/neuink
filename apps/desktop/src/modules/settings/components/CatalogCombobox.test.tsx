// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CatalogCombobox } from './CatalogCombobox';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(256);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(416);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('moves by the visible page size in taller and constrained lists', () => {
  const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(512);
  render(<CatalogCombobox label="提供商" buttonLabel="展开" value="" placeholder="搜索" busy={false}
    options={() => Array.from({ length: 30 }, (_, index) => ({ key: String(index), content: `Provider ${index}`, select: vi.fn() }))} />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'PageDown' });
  expect(screen.getByRole('option', { selected: true }).getAttribute('aria-posinset')).toBe('8');
  height.mockReturnValue(216);
  fireEvent.keyDown(input, { key: 'PageUp' });
  expect(screen.getByRole('option', { selected: true }).getAttribute('aria-posinset')).toBe('5');
});
it('opens and filters in the same input, does not choose during IME composition, and restores an uncommitted provider search', () => {
  const select = vi.fn();
  render(<CatalogCombobox label="提供商" buttonLabel="展开" value="原提供商" placeholder="搜索" busy={false}
    options={query => [{ key: 'demo', content: query || 'Demo', select }]} />);
  const input = screen.getByRole('combobox', { name: '提供商' });
  fireEvent.focus(input);
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getAllByRole('combobox')).toHaveLength(1);
  fireEvent.change(input, { target: { value: '测试' } });
  expect(screen.getByRole('option', { name: '测试' })).toBeTruthy();
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect((input as HTMLInputElement).value).toBe('原提供商');
  expect(screen.queryByRole('listbox')).toBeNull();
});
it('retains a custom model draft on Escape and lets Tab move on without choosing a suggestion', () => {
  const select = vi.fn();
  function Harness() {
    const [model, setModel] = useState('original');
    return <CatalogCombobox label="模型" buttonLabel="展开" value={model} placeholder="输入 ID" busy={false}
      onInput={setModel} options={() => [{ key: 'candidate', content: '候选', select }]} />;
  }
  render(<Harness />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'private-model' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect((input as HTMLInputElement).value).toBe('private-model');
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(input.getAttribute('aria-expanded')).toBe('false');
  expect(select).not.toHaveBeenCalled();
});
