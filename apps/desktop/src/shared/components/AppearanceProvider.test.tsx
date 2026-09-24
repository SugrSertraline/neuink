// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceProvider, APP_APPEARANCE_STORAGE_KEY, GLASS_TRANSPARENCY_STORAGE_KEY, useAppearance } from './AppearanceProvider';
import { AppearanceExit } from './AppearanceExit';
import { ToastContext } from '../hooks/useToast';

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-theme'); });
const wrapper = AppearanceProvider;

describe('the opt-in application material layer', () => {
  it('does not activate from the Demo preference or change an existing accent', () => {
    window.localStorage.setItem('neuink:atelier-demo:appearance', 'atelier');
    window.localStorage.setItem('neuink.themePreset', 'violet');
    document.documentElement.dataset.theme = 'violet';
    const { result } = renderHook(useAppearance, { wrapper });
    expect(result.current.appearance).toBe('standard');
    expect(document.documentElement.hasAttribute('data-appearance')).toBe(false);
    expect(window.localStorage.getItem(APP_APPEARANCE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('violet');
  });
  it('remembers explicit entry across mounts and restores the prior accent on exit', () => {
    window.localStorage.setItem('neuink.themePreset', 'green');
    document.documentElement.dataset.theme = 'green';
    const first = renderHook(useAppearance, { wrapper });
    act(() => { expect(first.result.current.setAppearance('atelier')).toBe(true); });
    expect(document.documentElement.dataset.appearance).toBe('atelier');
    first.unmount();
    const next = renderHook(useAppearance, { wrapper });
    expect(next.result.current.appearance).toBe('atelier');
    act(() => { next.result.current.setAppearance('standard'); });
    expect(document.documentElement.hasAttribute('data-appearance')).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('green');
    expect(window.localStorage.getItem('neuink.themePreset')).toBe('green');
    next.unmount();
    expect(renderHook(useAppearance, { wrapper }).result.current.appearance).toBe('standard');
  });
  it('stores the book/list choice separately from the original table preferences', () => {
    window.localStorage.setItem('neuink.entryLibraryColumns.v1', '["title"]');
    const first = renderHook(useAppearance, { wrapper });
    act(() => { first.result.current.setLibraryDisplay('list'); first.result.current.setAppearance('atelier'); });
    first.unmount();
    expect(renderHook(useAppearance, { wrapper }).result.current.libraryDisplay).toBe('list');
    expect(window.localStorage.getItem('neuink.entryLibraryColumns.v1')).toBe('["title"]');
  });
  it('still switches locally if browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(useAppearance, { wrapper });
    act(() => { expect(result.current.setAppearance('atelier')).toBe(false); });
    expect(document.documentElement.dataset.appearance).toBe('atelier');
    act(() => { expect(result.current.setAppearance('liquid-glass')).toBe(false); expect(result.current.setGlassReducedTransparency(true)).toBe(false); });
    expect(document.documentElement.dataset.appearance).toBe('liquid-glass');
    expect(document.documentElement.dataset.glassTransparency).toBe('reduced');
    act(() => { expect(result.current.setAppearance('standard')).toBe(false); });
    expect(document.documentElement.hasAttribute('data-appearance')).toBe(false);
    expect(document.documentElement.hasAttribute('data-glass-transparency')).toBe(false);
  });
  it('persists glass and its readability preference independently of the study display preference', () => {
    const first = renderHook(useAppearance, { wrapper });
    act(() => { first.result.current.setLibraryDisplay('list'); first.result.current.setAppearance('liquid-glass'); first.result.current.setGlassReducedTransparency(true); });
    first.unmount();
    expect(document.documentElement.hasAttribute('data-glass-transparency')).toBe(false);
    const next = renderHook(useAppearance, { wrapper });
    expect(next.result.current.appearance).toBe('liquid-glass');
    expect(next.result.current.libraryDisplay).toBe('list');
    expect(document.documentElement.dataset.glassTransparency).toBe('reduced');
    act(() => { next.result.current.setAppearance('atelier'); });
    expect(document.documentElement.hasAttribute('data-glass-transparency')).toBe(false);
    expect(window.localStorage.getItem(GLASS_TRANSPARENCY_STORAGE_KEY)).toBe('true');
    act(() => { next.result.current.setAppearance('liquid-glass'); next.result.current.setGlassReducedTransparency(false); });
    expect(document.documentElement.hasAttribute('data-glass-transparency')).toBe(false);
    expect(window.localStorage.getItem(GLASS_TRANSPARENCY_STORAGE_KEY)).toBeNull();
  });
  it('ignores unknown persisted appearances', () => {
    window.localStorage.setItem(APP_APPEARANCE_STORAGE_KEY, 'unknown');
    expect(renderHook(useAppearance, { wrapper }).result.current.appearance).toBe('standard');
  });
  it('preserves an in-progress draft when switching materials and using the exit shortcut', () => {
    function Draft() {
      const [draft, setDraft] = useState('');
      const { setAppearance } = useAppearance();
      return <><input aria-label="草稿" value={draft} onChange={event => setDraft(event.target.value)} />
        <button onClick={() => setAppearance('liquid-glass')}>玻璃</button><button onClick={() => setAppearance('atelier')}>书房</button><AppearanceExit /></>;
    }
    render(<AppearanceProvider><ToastContext.Provider value={{ dismiss: vi.fn(), notify: vi.fn(() => 'theme') }}><Draft /></ToastContext.Provider></AppearanceProvider>);
    fireEvent.change(screen.getByLabelText('草稿'), { target: { value: '未保存的研究想法' } });
    fireEvent.click(screen.getByText('玻璃'));
    fireEvent.click(screen.getByText('书房'));
    fireEvent.click(screen.getByText('玻璃'));
    fireEvent.click(screen.getByText('退出玻璃'));
    expect((screen.getByLabelText('草稿') as HTMLInputElement).value).toBe('未保存的研究想法');
    expect(document.documentElement.hasAttribute('data-appearance')).toBe(false);
  });
});
