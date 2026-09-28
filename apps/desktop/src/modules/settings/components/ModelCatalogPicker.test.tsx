// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelCatalogPicker } from './ModelCatalogPicker';
import type { CatalogModel } from '@/modules/assistant/sdk/modelCatalog';
const catalog: CatalogModel[] = Array.from({ length: 100 }, (_, i) => ({ id: `model-${i}`, label: `Model ${i}`, providerId: 'demo', providerName: 'Demo', providerApi: 'https://demo.example/v1', maxContextLength: 128000, metadataSource: 'models_dev' }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(256);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(416);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('searchable public model picker', () => {
  it('only lists the chosen provider even before its address is configured, without another scope selector', () => {
    render(<ModelCatalogPicker baseUrl="" providerId="demo" model="" presets={[]} catalog={[catalog[0], { ...catalog[0], providerId: 'other', providerName: 'Other' }]} busy={false} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '从模型列表选择' }));
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.queryByRole('option', { name: /Other/ })).toBeNull();
  });
  it('combines an editable ID with explicit custom selection and preserves typing on Escape', () => {
    const custom = vi.fn(), select = vi.fn();
    render(<ModelCatalogPicker baseUrl="https://demo.example/v1" model="my-original" presets={[]} catalog={catalog} busy={false} onSelect={select} onCustomChange={custom} />);
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'private:latest' } });
    expect(custom).toHaveBeenCalledWith('private:latest');
    fireEvent.click(screen.getByRole('button', { name: '从模型列表选择' }));
    const search = screen.getByRole('combobox', { name: '模型 ID' });
    fireEvent.change(search, { target: { value: 'custom/deployment-v2' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(custom).toHaveBeenLastCalledWith('custom/deployment-v2'); expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '从模型列表选择' }));
    fireEvent.change(screen.getByRole('combobox', { name: '模型 ID' }), { target: { value: 'custom/deployment-v2' } });
    fireEvent.click(screen.getByRole('option', { name: '使用自定义 ID：custom/deployment-v2' }));
    expect(custom).toHaveBeenLastCalledWith('custom/deployment-v2');
  });
  it('bounds rendered rows, supports searching and keyboard selection', async () => {
    const onSelect = vi.fn();
    render(<ModelCatalogPicker baseUrl="https://demo.example/v1" model="" presets={[]} catalog={catalog} busy={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '从模型列表选择' }));
    expect(screen.getAllByRole('option').length).toBeLessThan(20);
    const search = screen.getByRole('combobox', { name: '模型 ID' });
    fireEvent.change(search, { target: { value: 'model-99' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'model-99', maxContextLength: 128000 })));
    expect(screen.getByRole('combobox', { name: '模型 ID' }).getAttribute('aria-expanded')).toBe('false');
  });
  it('keeps unmatched gateways scoped and escapes without choosing unrelated public models', async () => {
    const onSelect = vi.fn();
    render(<ModelCatalogPicker baseUrl="https://custom.example/v1" model="" presets={[]} catalog={catalog} busy={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '从模型列表选择' }));
    expect(screen.getByText(/未找到匹配模型/)).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.keyDown(screen.getByRole('combobox', { name: '模型 ID' }), { key: 'Escape' });
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('does not open a disabled picker', () => {
    render(<ModelCatalogPicker baseUrl="" model="" presets={[]} catalog={catalog} busy onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '从模型列表选择' }));
    expect(screen.getByRole('combobox', { name: '模型 ID' }).getAttribute('aria-expanded')).toBe('false');
  });
});
