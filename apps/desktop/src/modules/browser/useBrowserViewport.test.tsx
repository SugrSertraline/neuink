// @vitest-environment jsdom
import { StrictMode, useRef } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserCommand, listenBrowser, nativeBrowserAvailable } from '@/shared/ipc/browserApi';
import { useBrowserViewport } from './useBrowserViewport';

vi.mock('@/shared/ipc/browserApi', () => ({ nativeBrowserAvailable: vi.fn(), browserCommand: vi.fn(), listenBrowser: vi.fn() }));
let node: HTMLDivElement;
let stop: ReturnType<typeof vi.fn>;
let notifyResize: () => void;
beforeEach(() => {
  vi.resetAllMocks(); stop = vi.fn(); vi.mocked(listenBrowser).mockResolvedValue(stop);
  vi.mocked(nativeBrowserAvailable).mockReturnValue(true);
  vi.mocked(browserCommand).mockResolvedValue(undefined);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notifyResize = () => callback([], this as unknown as ResizeObserver); }
    observe() {} unobserve() {} disconnect() {}
  });
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  node = document.createElement('div'); document.body.append(node);
  node.getBoundingClientRect = () => ({ x: 20, y: 80, width: 500, height: 600 } as DOMRect);
});
afterEach(() => { cleanup(); node.remove(); vi.unstubAllGlobals(); });
const hook = (active: boolean) => { const ref = useRef(node); return useBrowserViewport('test', ref, active, vi.fn()); };
const layoutCalls = () => vi.mocked(browserCommand).mock.calls.filter(call => call[1] === 'layout');
const flushLayoutFrame = async () => { await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 0)); }); };
async function resizeViewport(x: number, width: number) {
  act(() => {
    node.getBoundingClientRect = () => ({ x, y: 80, width, height: 600 } as DOMRect);
    notifyResize();
  });
  await flushLayoutFrame();
}
it('keeps a WebView alive when hidden and releases it on close, including a late listener', async () => {
  const ui = renderHook(({ active }) => hook(active), { initialProps: { active: true } });
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(browserCommand).toHaveBeenCalledWith('test', 'layout', expect.objectContaining({ visible: true })));
  ui.rerender({ active: false });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: false })));
  expect(vi.mocked(browserCommand).mock.calls.filter(call => call[1] === 'create')).toHaveLength(1);
  ui.unmount(); await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'close'));
  expect(stop).toHaveBeenCalledOnce();
});
it.each(['dialog', 'alertdialog', 'menu', 'popover', 'tooltip'])('keeps the native page visible when a %s opens and closes', async role => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: true })));
  const wrapper = document.createElement('div'); wrapper.setAttribute('data-radix-popper-content-wrapper', '');
  const content = document.createElement('div'); content.setAttribute('role', role); content.dataset.state = 'open'; wrapper.append(content);
  act(() => {
    document.body.append(wrapper);
    node.getBoundingClientRect = () => ({ x: 20, y: 80, width: 450, height: 600 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
  });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 20, y: 80, width: 450, height: 600, pixel_ratio: 1 }
  }));
  act(() => {
    content.dataset.state = 'closed';
    node.getBoundingClientRect = () => ({ x: 20, y: 80, width: 500, height: 600 } as DOMRect);
    window.dispatchEvent(new Event('resize'));
  });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 20, y: 80, width: 500, height: 600, pixel_ratio: 1 }
  }));
  expect(vi.mocked(browserCommand).mock.calls.some(call => call[1] === 'layout' && call[2]?.visible === false)).toBe(false);
  expect(vi.mocked(browserCommand).mock.calls.filter(call => call[1] === 'create')).toHaveLength(1);
  expect(vi.mocked(browserCommand).mock.calls.some(call => ['close', 'navigate', 'reload'].includes(call[1]))).toBe(false);
  act(() => wrapper.remove());
});
it('keeps native page content visible throughout tab dragging and geometry changes without recreating it', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: true })));
  const drag = document.createElement('div'); drag.className = 'workspace-tab-drag-layer';
  act(() => { document.body.append(drag); node.getBoundingClientRect = () => ({ x: 520, y: 80, width: 400, height: 600 } as DOMRect); window.dispatchEvent(new Event('resize')); });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', { visible: true, bounds: { x: 520, y: 80, width: 400, height: 600, pixel_ratio: 1 } }));
  act(() => drag.remove());
  expect(vi.mocked(browserCommand).mock.calls.some(call => call[1] === 'layout' && call[2]?.visible === false)).toBe(false);
  expect(vi.mocked(browserCommand).mock.calls.filter(call => call[1] === 'create')).toHaveLength(1);
});
it.each(['is-sidebar-resizing', 'is-resizing', 'is-workspace-split-resizing'])('keeps the page visible throughout %s and follows its geometry', async className => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: true })));
  const resizing = document.createElement('div'); resizing.className = className;
  act(() => {
    node.getBoundingClientRect = () => ({ x: 120, y: 80, width: 400, height: 600 } as DOMRect);
    document.body.append(resizing);
  });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 120, y: 80, width: 400, height: 600, pixel_ratio: 1 }
  }));
  act(() => {
    node.getBoundingClientRect = () => ({ x: 140, y: 80, width: 380, height: 600 } as DOMRect);
    resizing.remove();
  });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 140, y: 80, width: 380, height: 600, pixel_ratio: 1 }
  }));
  expect(vi.mocked(browserCommand).mock.calls.some(call => call[1] === 'layout' && call[2]?.visible === false)).toBe(false);
  expect(vi.mocked(browserCommand).mock.calls.filter(call => call[1] === 'create')).toHaveLength(1);
  expect(vi.mocked(browserCommand).mock.calls.some(call => ['close', 'navigate', 'reload'].includes(call[1]))).toBe(false);
});
it('does not cache a failed native layout as successfully applied', async () => {
  let failed = false;
  vi.mocked(browserCommand).mockImplementation(async (_id, action) => { if (action === 'layout' && !failed) { failed = true; throw new Error('temporary'); } });
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(ui.result.current.error).toBeTruthy());
  act(() => { window.dispatchEvent(new Event('resize')); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(2));
  expect(layoutCalls()[0][2]).toEqual(layoutCalls()[1][2]);
  expect(layoutCalls()[1][2]).toEqual({ visible: true, bounds: { x: 20, y: 80, width: 500, height: 600, pixel_ratio: 1 } });
});
it('coalesces a ResizeObserver burst to the in-flight layout and newest size without recreating the page', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(1));
  vi.mocked(browserCommand).mockClear();
  let finish!: () => void;
  vi.mocked(browserCommand).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await resizeViewport(70, 450);
  expect(layoutCalls()).toHaveLength(1);
  for (let width = 440; width >= 340; width -= 10) await resizeViewport(520 - width, width);
  expect(layoutCalls()).toHaveLength(1);
  await act(async () => { finish(); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(2));
  expect(layoutCalls().map(call => call[2])).toEqual([
    { visible: true, bounds: { x: 70, y: 80, width: 450, height: 600, pixel_ratio: 1 } },
    { visible: true, bounds: { x: 180, y: 80, width: 340, height: 600, pixel_ratio: 1 } }
  ]);
  await flushLayoutFrame();
  expect(vi.mocked(browserCommand).mock.calls).toEqual(layoutCalls());
});
it('applies the rollback size even when it matches the last settled size before an in-flight resize', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(1));
  vi.mocked(browserCommand).mockClear();
  let finish!: () => void;
  vi.mocked(browserCommand).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await resizeViewport(120, 400);
  await resizeViewport(140, 380);
  await resizeViewport(20, 500);
  expect(layoutCalls()).toHaveLength(1);
  await act(async () => { finish(); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(2));
  expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 20, y: 80, width: 500, height: 600, pixel_ratio: 1 }
  });
  expect(vi.mocked(browserCommand).mock.calls).toEqual(layoutCalls());
});
it('replaces pending visible geometry with hidden state and restores only the latest geometry', async () => {
  const ui = renderHook(({ active }) => hook(active), { initialProps: { active: true } });
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(1));
  vi.mocked(browserCommand).mockClear();
  let finish!: () => void;
  vi.mocked(browserCommand).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await resizeViewport(120, 400);
  await resizeViewport(140, 380);
  ui.rerender({ active: false });
  await flushLayoutFrame();
  expect(layoutCalls()).toHaveLength(1);
  await act(async () => { finish(); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(2));
  expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: false, bounds: { x: 140, y: 80, width: 380, height: 600, pixel_ratio: 1 }
  });
  ui.rerender({ active: true });
  await waitFor(() => expect(layoutCalls()).toHaveLength(3));
  expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 140, y: 80, width: 380, height: 600, pixel_ratio: 1 }
  });
  expect(vi.mocked(browserCommand).mock.calls).toEqual(layoutCalls());
});
it('discards replacement geometry on close and waits for the in-flight layout before releasing the view', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(1));
  vi.mocked(browserCommand).mockClear();
  let finish!: () => void;
  vi.mocked(browserCommand).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await resizeViewport(120, 400);
  await resizeViewport(140, 380);
  ui.unmount();
  expect(browserCommand).not.toHaveBeenCalledWith('test', 'close');
  await act(async () => { finish(); });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'close'));
  await resizeViewport(160, 360);
  expect(layoutCalls()).toHaveLength(1);
  expect(vi.mocked(browserCommand).mock.calls.map(call => call[1])).toEqual(['layout', 'close']);
  expect(stop).toHaveBeenCalledOnce();
});
it('creates and resizes using the current host pixel ratio without re-navigating', async () => {
  vi.stubGlobal('devicePixelRatio', 1.875);
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  const bounds = { x: 20, y: 80, width: 500, height: 600, pixel_ratio: 1.875 };
  expect(browserCommand).toHaveBeenCalledWith('test', 'create', { url: 'https://example.org/', bounds });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', { visible: true, bounds }));
  expect(vi.mocked(browserCommand).mock.calls.map(call => call[1])).toEqual(['create', 'layout']);
});
it('resynchronizes unchanged DOM bounds when the host pixel ratio changes', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(1));
  vi.mocked(browserCommand).mockClear();
  act(() => { vi.stubGlobal('devicePixelRatio', 1.875); window.dispatchEvent(new Event('resize')); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(1));
  expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', {
    visible: true, bounds: { x: 20, y: 80, width: 500, height: 600, pixel_ratio: 1.875 }
  });
  act(() => window.dispatchEvent(new Event('resize')));
  await flushLayoutFrame();
  expect(vi.mocked(browserCommand).mock.calls).toHaveLength(1);
});
it('closes only after late creation settles and does not issue a late show', async () => {
  let finish!: () => void;
  vi.mocked(browserCommand).mockImplementation(async (_id, action) => { if (action === 'create') await new Promise<void>(resolve => { finish = resolve; }); });
  const ui = renderHook(() => hook(true));
  let reading!: Promise<void>;
  act(() => { reading = ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  ui.unmount(); expect(browserCommand).not.toHaveBeenCalledWith('test', 'close');
  await act(async () => { finish(); await reading; });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'close'));
  expect(vi.mocked(browserCommand).mock.calls.some(call => call[1] === 'layout')).toBe(false);
});
it('serializes StrictMode cleanup before a new WebView session and releases delayed subscriptions', async () => {
  const stops: (() => void)[] = [];
  vi.mocked(listenBrowser).mockImplementation(async () => { const cleanup = vi.fn(); stops.push(cleanup); return cleanup; });
  const ui = renderHook(() => hook(true), { wrapper: StrictMode });
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await act(async () => { await ui.result.current.zoom(1.25); });
  const calls = vi.mocked(browserCommand).mock.calls.map(c => c[1]);
  expect(calls.indexOf('close')).toBeLessThan(calls.indexOf('create'));
  expect(calls.indexOf('create')).toBeLessThan(calls.indexOf('zoom'));
  ui.unmount(); await waitFor(() => stops.forEach(stop => expect(stop).toHaveBeenCalledOnce()));
});

it('zooms the existing native page without navigating, recreating, or changing its layout', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: true })));
  vi.mocked(browserCommand).mockClear();
  await act(async () => { await ui.result.current.zoom(1.25); await ui.result.current.zoom(1); });
  expect(vi.mocked(browserCommand).mock.calls).toEqual([
    ['test', 'zoom', { zoom: 1.25 }], ['test', 'zoom', { zoom: 1 }]
  ]);
});

it.each([false, true])('refuses zoom before a native page is created (native=%s)', async native => {
  vi.mocked(nativeBrowserAvailable).mockReturnValue(native);
  const ui = renderHook(() => hook(true));
  await expect(ui.result.current.zoom(1.25)).rejects.toThrow('网页尚未就绪');
  expect(browserCommand).not.toHaveBeenCalled();
});

it.each([0.49, 3.01, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid zoom %s without a native call', async factor => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await expect(ui.result.current.zoom(factor)).rejects.toThrow('50%–300%');
  expect(vi.mocked(browserCommand).mock.calls.some(call => call[1] === 'zoom')).toBe(false);
});

it('discards a queued zoom when its owner closes and closes only after in-flight work', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: true })));
  let finish!: () => void;
  vi.mocked(browserCommand).mockImplementation(async (_id, action) => {
    if (action === 'reload') await new Promise<void>(resolve => { finish = resolve; });
  });
  let reload!: Promise<unknown>;
  act(() => { reload = ui.result.current.action('reload'); });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  const zoom = ui.result.current.zoom(1.5);
  expect(vi.mocked(browserCommand).mock.calls.some(call => call[1] === 'zoom')).toBe(false);
  ui.unmount();
  expect(browserCommand).not.toHaveBeenCalledWith('test', 'close');
  await act(async () => { finish(); await reload; await zoom; });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'close'));
  expect(vi.mocked(browserCommand).mock.calls.some(call => call[1] === 'zoom')).toBe(false);
  await expect(ui.result.current.zoom(1)).rejects.toThrow('网页尚未就绪');
  expect(stop).toHaveBeenCalledOnce();
});

it('reports zoom failure to its caller without invalidating the page or preventing later zoom', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: true })));
  vi.mocked(browserCommand).mockRejectedValueOnce(new Error('native zoom failed'));
  await expect(ui.result.current.zoom(1.25)).rejects.toThrow('native zoom failed');
  expect(ui.result.current.error).toBeNull();
  await act(async () => { await ui.result.current.zoom(1); });
  expect(browserCommand).toHaveBeenLastCalledWith('test', 'zoom', { zoom: 1 });
  expect(vi.mocked(browserCommand).mock.calls.filter(call => call[1] === 'create')).toHaveLength(1);
});
