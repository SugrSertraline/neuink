// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideSelectionToolbar } from './GuideSelectionToolbar';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(720);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this:HTMLElement) {
    const height = this.hasAttribute('data-guide-selection-toolbar') ? 170 : 720;
    return { x:0, y:0, left:0, top:0, right:1280, bottom:height, width:1280, height } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('GuideSelectionToolbar placement', () => {
  const viewport = () => ({ current:document.createElement('div') });
  const region = () => screen.getByRole('region', { name:'选区操作演示（不执行操作）' });

  it('flips upward at the bottom edge of the actual visible PDF pane', () => {
    render(<GuideSelectionToolbar text="Selected text" viewport={viewport()}
      surface={{ x:400, y:100, width:600, height:400 }} selection={{ x:940, y:475, width:40, height:16 }} />);
    expect(region().dataset.placement).toBe('above');
    expect(parseFloat(region().style.left) + 368).toBeLessThanOrEqual(992);
    expect(parseFloat(region().style.top)).toBeGreaterThanOrEqual(108);
  });

  it('fits a narrow split reader without extending into its neighbor', () => {
    render(<GuideSelectionToolbar text="Selected text" viewport={viewport()}
      surface={{ x:500, y:100, width:250, height:550 }} selection={{ x:510, y:180, width:100, height:16 }} />);
    expect(region().style.width).toBe('234px');
    expect(region().style.left).toBe('508px');
    expect(region().style.top).toBe('204px');
  });

  it('keeps normalized offsets at 125% UI scaling instead of scaling them twice', () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function(this:HTMLElement) {
      const height = this.hasAttribute('data-guide-selection-toolbar') ? 212.5 : 900;
      return { x:0, y:0, left:0, top:0, right:1600, bottom:height, width:1600, height } as DOMRect;
    });
    render(<GuideSelectionToolbar text="Selected text" viewport={viewport()}
      surface={{ x:400, y:100, width:600, height:400 }} selection={{ x:500, y:475, width:100, height:16 }} />);
    expect(region().style.top).toBe('297px');
    expect(region().dataset.placement).toBe('above');
  });

  it('disconnects its resize observer on exit', () => {
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
    const ui = render(<GuideSelectionToolbar text="Selected text" viewport={viewport()}
      surface={{ x:400, y:100, width:600, height:400 }} selection={{ x:500, y:180, width:100, height:16 }} />);
    ui.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
