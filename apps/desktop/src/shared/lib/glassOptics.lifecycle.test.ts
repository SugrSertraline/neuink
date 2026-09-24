// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGlassOptics } from './glassOptics';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('optical resource lifetime', () => {
  it('reuses maps for equal geometry, bounds live lenses and releases every node on disposal', () => {
    const disconnect = vi.fn(), unobserve = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve = unobserve; disconnect = disconnect; });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(32);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: vi.fn() } as unknown as CanvasRenderingContext2D);
    const optics = createGlassOptics();
    const buttons = Array.from({ length: 15 }, () => document.createElement('button'));
    try {
      buttons.forEach(button => optics.add(button));
      expect(document.querySelectorAll('[data-glass-optics] filter').length).toBe(12);
      expect(encode).toHaveBeenCalledTimes(1);
      optics.remove(buttons[0]);
      expect(buttons[0].style.getPropertyValue('--glass-lens')).toBe('');
      expect(unobserve).toHaveBeenCalledWith(buttons[0]);
      optics.add(buttons[12]);
      expect(document.querySelectorAll('[data-glass-optics] filter').length).toBe(12);
    } finally { optics.dispose(); }
    expect(document.querySelector('[data-glass-optics]')).toBeNull();
    expect(buttons.every(button => !button.style.getPropertyValue('--glass-lens'))).toBe(true);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
