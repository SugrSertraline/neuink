// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlassMaterial } from './useGlassMaterial';
import { createGlassOptics } from '../lib/glassOptics';

vi.mock('../lib/glassOptics', () => ({ createGlassOptics: vi.fn() }));

let fixture: HTMLDivElement;
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> }[];
beforeEach(() => {
  vi.useFakeTimers();
  media = [];
  vi.stubGlobal('matchMedia', vi.fn(() => {
    const query = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    media.push(query); return query;
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(16), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40, toJSON() {} });
  fixture = document.createElement('div');
  fixture.innerHTML = '<div data-material="workspace-toolbar"><button data-ui="button"><span>One</span></button><button data-ui="button" disabled>Two</button><input data-slot="input" readonly /></div>';
  document.body.append(fixture);
});
afterEach(() => { cleanup(); fixture.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function move(target: Element, x: number, buttons = 0) {
  fireEvent(target, new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: 10, buttons }));
}
const frame = () => act(() => { vi.advanceTimersByTime(16); });

describe('theme-owned transient glass light', () => {
  it('does no work outside glass, batches pointer samples, and clears styles when leaving the theme', () => {
    const { rerender } = renderHook(({ enabled }) => useGlassMaterial(enabled), { initialProps: { enabled: false } });
    const button = fixture.querySelector('button')!;
    move(button, 20); frame(); expect(button.hasAttribute('data-glass-light')).toBe(false);
    rerender({ enabled: true });
    move(button.firstElementChild!, 20); move(button, 80);
    expect(button.hasAttribute('data-glass-light')).toBe(false);
    frame(); expect(button.style.getPropertyValue('--glass-pointer-x')).toBe('80.0%');
    expect(button.textContent).toBe('One');
    rerender({ enabled: false });
    expect(button.hasAttribute('data-glass-light')).toBe(false);
    expect(button.style.getPropertyValue('--glass-pointer-x')).toBe('');
  });
  it('does not light disabled/read-only controls or consume clicks and drag events', () => {
    renderHook(() => useGlassMaterial(true));
    for (const element of fixture.querySelectorAll(':disabled, [readonly]')) {
      move(element, 20); frame(); expect(element.hasAttribute('data-glass-light')).toBe(false);
    }
    const button = fixture.querySelector('button')!;
    move(button, 20); frame();
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    expect(button.dispatchEvent(event)).toBe(true); expect(event.defaultPrevented).toBe(false);
    expect(button.hasAttribute('data-glass-light')).toBe(false);
    move(button, 50, 1); frame(); expect(button.hasAttribute('data-glass-light')).toBe(false);
  });
  it('cancels stale samples on scroll and window blur', () => {
    renderHook(() => useGlassMaterial(true));
    const button = fixture.querySelector('button')!;
    move(button, 20); fireEvent.scroll(fixture); frame();
    expect(button.hasAttribute('data-glass-light')).toBe(false);
    move(button, 20); frame(); fireEvent(window, new Event('blur'));
    expect(button.hasAttribute('data-glass-light')).toBe(false);
  });
  it('restores the hover after release without changing absolute control placement', () => {
    renderHook(() => useGlassMaterial(true));
    const button = fixture.querySelector('button')!;
    button.style.position = 'absolute';
    fireEvent(button, new MouseEvent('pointerup', { bubbles: true, clientX: 70, clientY: 20 }));
    frame();
    expect(button.hasAttribute('data-glass-light')).toBe(true);
    expect(button.hasAttribute('data-glass-positioned')).toBe(false);
    expect(button.style.position).toBe('absolute');
  });
  it('uses the enclosing glass surface instead of stacking a second lens on its controls', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/130');
    vi.stubGlobal('CSS', { supports: () => true });
    vi.stubGlobal('ResizeObserver', class {});
    const optics = { add: vi.fn(), remove: vi.fn(), dispose: vi.fn() };
    vi.mocked(createGlassOptics).mockReturnValue(optics);
    fixture.innerHTML = '<button data-ui="button">Standalone</button><div data-material="reader-toolbar"><button data-ui="button">Reader</button></div><div data-slot="popover-content"><button data-ui="button">Menu</button></div>';
    const [standalone, readerButton, menuButton] = fixture.querySelectorAll('button');
    const reader = readerButton.parentElement!, menu = menuButton.parentElement!;
    const { unmount } = renderHook(() => useGlassMaterial(true));
    expect(optics.add.mock.calls.map(([element]) => element)).toEqual([reader, menu]);
    move(standalone, 20); frame();
    expect(optics.add).toHaveBeenLastCalledWith(standalone);
    for (const button of [readerButton, menuButton]) {
      move(button, 40); frame();
      expect(button.hasAttribute('data-glass-light')).toBe(true);
      expect(optics.add).not.toHaveBeenCalledWith(button);
    }
    expect(optics.remove).toHaveBeenCalledWith(standalone);
    unmount();
    expect(optics.dispose).toHaveBeenCalledOnce();
    expect(readerButton.hasAttribute('data-glass-light')).toBe(false);
    expect(menuButton.hasAttribute('data-glass-light')).toBe(false);
  });
  it('reacts immediately to each accessibility preference and removes listeners on unmount', () => {
    const { unmount } = renderHook(() => useGlassMaterial(true));
    const button = fixture.querySelector('button')!;
    for (const preference of media) {
      move(button, 20); frame(); expect(button.hasAttribute('data-glass-light')).toBe(true);
      preference.matches = true;
      act(() => preference.addEventListener.mock.calls[0][1]());
      move(button, 20); frame(); expect(button.hasAttribute('data-glass-light')).toBe(false);
      preference.matches = false;
      act(() => preference.addEventListener.mock.calls[0][1]());
    }
    unmount();
    expect(media.every(query => query.removeEventListener.mock.calls.length === 1)).toBe(true);
    move(button, 20); frame(); expect(button.hasAttribute('data-glass-light')).toBe(false);
  });
});
