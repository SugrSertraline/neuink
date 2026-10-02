// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { findSpotlightTarget, useSpotlight } from './useSpotlight';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('does not fall back to a user surface while the bound view is absent or hidden', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, right:1000, bottom:800, width:1000, height:800 } as DOMRect);
  const view = render(<><div data-workspace-surface-key="pdf:user" data-workspace-surface-active="true"><div data-guide="pdf-page" /></div>
    <div data-workspace-surface-key="pdf:demo" data-workspace-surface-active="false"><div data-guide="pdf-page" /></div>
    <div data-viewport /></>);
  const viewport = view.container.querySelector<HTMLElement>('[data-viewport]')!;
  expect(findSpotlightTarget('[data-guide="pdf-page"]', viewport, null)).toBeUndefined();
  expect(findSpotlightTarget('[data-guide="pdf-page"]', viewport, 'pdf:demo')).toBeUndefined();
  expect(findSpotlightTarget('[data-guide="pdf-page"]', viewport, 'pdf:missing')).toBeUndefined();
  const demo = view.container.querySelector<HTMLElement>('[data-workspace-surface-key="pdf:demo"]')!;
  demo.dataset.workspaceSurfaceActive = 'true';
  expect(findSpotlightTarget('[data-guide="pdf-page"]', viewport, 'pdf:demo')).toBe(demo.firstElementChild);
});
it('normalizes CSS zoom, clamps the hole and disconnects observers on close', async () => {
  const disconnect = vi.fn(); const cancel = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect = disconnect; });
  vi.stubGlobal('requestAnimationFrame', (callback:FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', cancel);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this:HTMLElement) {
    return (this.dataset.fixture === 'target'
      ? { left:50, top:60, right:150, bottom:160, width:100, height:100 }
      : { left:0, top:0, right:600, bottom:400, width:600, height:400 }) as DOMRect;
  });
  function Harness({ enabled = true }: { enabled?:boolean }) {
    const viewport = useRef<HTMLDivElement>(null); const rect = useSpotlight('[data-fixture="target"]', viewport, enabled);
    return <><div data-fixture="target" /><div ref={viewport} data-guide-overlay><output>{JSON.stringify(rect)}</output></div></>;
  }
  const view = render(<Harness />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
  expect(JSON.parse(screen.getByRole('status').textContent!)).toMatchObject({ x:96, y:116, width:208, height:208, viewportWidth:1200, viewportHeight:800 });
  view.rerender(<Harness enabled={false} />);
  expect(screen.getByRole('status').textContent).toBe('null');
  expect(disconnect).toHaveBeenCalledOnce();
  view.rerender(<Harness />);
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalled();
});

it('discards old geometry on step changes and waits for two stable frames', () => {
  const callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback:FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key:number) => callbacks.delete(key));
  const flush = () => act(() => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)); });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  let left = 50;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this:HTMLElement) {
    return (this.dataset.fixture === 'target'
      ? { left, top:60, right:left+100, bottom:160, width:100, height:100 }
      : { left:0, top:0, right:1200, bottom:800, width:1200, height:800 }) as DOMRect;
  });
  function Harness({ step }: { step:string }) {
    const viewport = useRef<HTMLDivElement>(null);
    const rect = useSpotlight('[data-fixture="target"]', viewport, true, step);
    return <><div data-fixture="target" /><div ref={viewport} data-guide-overlay><output>{JSON.stringify(rect)}</output></div></>;
  }
  const view = render(<Harness step="one" />);
  flush(); expect(screen.getByRole('status').textContent).toBe('null');
  left = 320;
  flush(); expect(screen.getByRole('status').textContent).toBe('null');
  flush(); expect(JSON.parse(screen.getByRole('status').textContent!).x).toBe(316);
  view.rerender(<Harness step="two" />);
  expect(screen.getByRole('status').textContent).toBe('null');
  flush(); expect(screen.getByRole('status').textContent).toBe('null');
  flush(); expect(JSON.parse(screen.getByRole('status').textContent!).x).toBe(316);
  expect(callbacks.size).toBe(0);
  view.unmount(); expect(callbacks.size).toBe(0);
});

it('waits for the PDF raster to be ready before revealing its spotlight', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback:FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout.bind(window));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, right:1200, bottom:800, width:1200, height:800 } as DOMRect);
  function Harness() {
    const viewport = useRef<HTMLDivElement>(null);
    const rect = useSpotlight('[data-guide="pdf-page"]', viewport);
    return <><div data-guide="pdf-page"><canvas /></div><div ref={viewport} data-guide-overlay><output>{JSON.stringify(rect)}</output></div></>;
  }
  render(<Harness />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(screen.getByRole('status').textContent).toBe('null');
  act(() => { document.querySelector('canvas')!.dataset.pdfRendered = 'true'; });
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('viewportWidth'));
});

it('updates an already visible spotlight in one frame while scrolling, without returning to loading', () => {
  const callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback:FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key:number) => callbacks.delete(key));
  const flush = () => act(() => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)); });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  let top = 140;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this:HTMLElement) {
    return (this.dataset.fixture === 'target'
      ? { left:50, top, right:150, bottom:top+100, width:100, height:100 }
      : { left:0, top:0, right:1200, bottom:800, width:1200, height:800 }) as DOMRect;
  });
  function Harness() {
    const viewport = useRef<HTMLDivElement>(null);
    const rect = useSpotlight('[data-fixture="target"]', viewport);
    return <><div data-fixture="target" /><img alt="教程截图" /><div ref={viewport} data-guide-overlay><output>{JSON.stringify(rect)}</output></div></>;
  }
  const view = render(<Harness />);
  flush(); flush(); expect(JSON.parse(screen.getByRole('status').textContent!).y).toBe(136);
  for (top of [130, 110, 100]) {
    fireEvent.scroll(document); flush();
    expect(JSON.parse(screen.getByRole('status').textContent!).y).toBe(top - 4);
    expect(callbacks.size).toBe(0);
  }
  // Loading a screenshot can shift controls even when no DOM mutation occurred.
  top = 320; fireEvent.load(screen.getByAltText('教程截图')); flush();
  expect(JSON.parse(screen.getByRole('status').textContent!).y).toBe(316);
  view.unmount(); expect(callbacks.size).toBe(0);
  fireEvent.scroll(document); fireEvent.load(document); expect(callbacks.size).toBe(0);
});
