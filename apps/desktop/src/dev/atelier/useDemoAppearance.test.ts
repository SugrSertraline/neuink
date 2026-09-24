// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDemoAppearance } from './useDemoAppearance';

beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the hidden demo appearance', () => {
  it('starts in the standard skin without opting in or touching other settings', () => {
    window.localStorage.setItem('production-theme', 'dark');
    const { result } = renderHook(useDemoAppearance);
    expect(result.current.skin).toBe('classic');
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem('production-theme')).toBe('dark');
  });

  it('restores an explicitly chosen skin after a new page mount', () => {
    const first = renderHook(useDemoAppearance);
    act(() => { expect(first.result.current.setSkin('atelier')).toBe(true); });
    first.unmount();
    const nextPage = renderHook(useDemoAppearance);
    expect(nextPage.result.current.skin).toBe('atelier');
  });

  it('keeps an explicit exit effective after reopening, without deleting unrelated settings', () => {
    window.localStorage.setItem('production-theme', 'dark');
    const first = renderHook(useDemoAppearance);
    act(() => { first.result.current.setSkin('atelier'); });
    act(() => { first.result.current.setSkin('classic'); });
    first.unmount();
    expect(renderHook(useDemoAppearance).result.current.skin).toBe('classic');
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem('production-theme')).toBe('dark');
  });

  it('still switches locally when the browser refuses storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(useDemoAppearance);
    expect(result.current.skin).toBe('classic');
    act(() => { expect(result.current.setSkin('atelier')).toBe(false); });
    expect(result.current.skin).toBe('atelier');
  });
});
