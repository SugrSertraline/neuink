// @vitest-environment jsdom
import { StrictMode, useRef } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserCommand, listenBrowser } from '@/shared/ipc/browserApi';
import { useBrowserViewport } from './useBrowserViewport';

vi.mock('@/shared/ipc/browserApi', () => ({ nativeBrowserAvailable: () => true, browserCommand: vi.fn(), listenBrowser: vi.fn() }));
let node: HTMLDivElement;
let stop: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks(); stop = vi.fn(); vi.mocked(listenBrowser).mockResolvedValue(stop);
  vi.mocked(browserCommand).mockResolvedValue(undefined);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  node = document.createElement('div'); document.body.append(node);
  node.getBoundingClientRect = () => ({ x: 20, y: 80, width: 500, height: 600 } as DOMRect);
});
afterEach(() => { cleanup(); node.remove(); vi.unstubAllGlobals(); });
const hook = (active: boolean) => { const ref = useRef(node); return useBrowserViewport('test', ref, active, vi.fn()); };
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
it('hides native content while a dialog overlays the document and restores it afterward', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
  act(() => document.body.append(dialog));
  await waitFor(() => expect(ui.result.current.covered).toBe(true));
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: false })));
  act(() => dialog.remove());
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: true })));
});
it('keeps native page content visible throughout tab dragging and geometry changes without recreating it', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: true })));
  const drag = document.createElement('div'); drag.className = 'workspace-tab-drag-layer';
  act(() => { document.body.append(drag); node.getBoundingClientRect = () => ({ x: 520, y: 80, width: 400, height: 600 } as DOMRect); window.dispatchEvent(new Event('resize')); });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', { visible: true, bounds: { x: 520, y: 80, width: 400, height: 600 } }));
  expect(ui.result.current.covered).toBe(false);
  act(() => drag.remove());
  expect(vi.mocked(browserCommand).mock.calls.some(call => call[1] === 'layout' && call[2]?.visible === false)).toBe(false);
  expect(vi.mocked(browserCommand).mock.calls.filter(call => call[1] === 'create')).toHaveLength(1);
});
it('restores the native page when a kept-mounted menu closes', async () => {
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  const wrapper = document.createElement('div'); wrapper.setAttribute('data-radix-popper-content-wrapper', '');
  const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.dataset.state = 'open'; wrapper.append(menu);
  act(() => document.body.append(wrapper));
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: false })));
  act(() => { menu.dataset.state = 'closed'; });
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'layout', expect.objectContaining({ visible: true })));
  act(() => wrapper.remove());
});
it('does not cache a failed native layout as successfully applied', async () => {
  let failed = false;
  vi.mocked(browserCommand).mockImplementation(async (_id, action) => { if (action === 'layout' && !failed) { failed = true; throw new Error('temporary'); } });
  const ui = renderHook(() => hook(true));
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(ui.result.current.error).toBeTruthy());
  act(() => { window.dispatchEvent(new Event('resize')); });
  await waitFor(() => expect(vi.mocked(browserCommand).mock.calls.filter(call => call[1] === 'layout').length).toBeGreaterThan(1));
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
  const calls = vi.mocked(browserCommand).mock.calls.map(c => c[1]);
  expect(calls.indexOf('close')).toBeLessThan(calls.indexOf('create'));
  ui.unmount(); await waitFor(() => stops.forEach(stop => expect(stop).toHaveBeenCalledOnce()));
});
