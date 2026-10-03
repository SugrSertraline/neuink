// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { browserCommand, listenBrowser, nativeBrowserAvailable } from '@/shared/ipc/browserApi';
import { useBrowserViewport } from './useBrowserViewport';

vi.mock('@/shared/ipc/browserApi', () => ({ nativeBrowserAvailable: vi.fn(), browserCommand: vi.fn(), listenBrowser: vi.fn() }));
const bounds = { x: 20, y: 80, width: 500, height: 600, pixel_ratio: 1 };
let viewport: HTMLDivElement;
let panel: HTMLDivElement;
let rect: { x: number; y: number; width: number; height: number };
let notifyResize: () => void;
let observe: ReturnType<typeof vi.fn>;
let unobserve: ReturnType<typeof vi.fn>;
let disconnect: ReturnType<typeof vi.fn>;
const frame = async () => { await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 10)); }); };
const layoutCalls = () => vi.mocked(browserCommand).mock.calls.filter(call => call[1] === 'layout');
const latestLayout = () => layoutCalls().slice(-1)[0]?.[2];
const hook = (active: boolean) => { const ref = useRef(viewport); return useBrowserViewport('test', ref, active, vi.fn()); };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(nativeBrowserAvailable).mockReturnValue(true);
  vi.mocked(browserCommand).mockResolvedValue(undefined);
  vi.mocked(listenBrowser).mockResolvedValue(() => {});
  observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notifyResize = () => callback([], this as unknown as ResizeObserver); }
    observe = observe; unobserve = unobserve; disconnect = disconnect;
  });
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  viewport = document.createElement('div'); viewport.getBoundingClientRect = () => new DOMRect(bounds.x, bounds.y, bounds.width, bounds.height);
  panel = document.createElement('div'); panel.dataset.nativeBrowserOverlay = 'task-dock'; panel.dataset.state = 'open';
  rect = { x: 300, y: 420, width: 360, height: 240 };
  panel.getBoundingClientRect = () => rect as DOMRect;
  document.body.append(viewport, panel);
});
afterEach(() => { cleanup(); viewport.remove(); panel.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function start() {
  const ui = renderHook(({ active }) => hook(active), { initialProps: { active: true } });
  await act(async () => { await ui.result.current.navigate('https://example.org/'); });
  await waitFor(() => expect(layoutCalls()).toHaveLength(1));
  return ui;
}

it('clips exactly the panel intersection without a background ring at 125% UI zoom and 150% DPI', async () => {
  vi.stubGlobal('devicePixelRatio', 1.875);
  await start();
  expect(latestLayout()).toEqual({ visible: true, bounds: { ...bounds, pixel_ratio: 1.875 },
    occlusions: [{ x: 300, y: 420, width: 220, height: 240 }] });
  expect(observe).toHaveBeenCalledWith(panel);
  expect(observe).toHaveBeenCalledWith(viewport);
});

it.each(['ordinary-popover', 'other-marker', 'closed', 'hidden', 'ancestor-hidden', 'display-none', 'invisible', 'transparent', 'empty', 'non-finite', 'outside'])
  ('omits occlusions for %s and never changes page bounds or visibility', async kind => {
    let wrapper: HTMLDivElement | undefined;
    if (kind === 'ordinary-popover') { delete panel.dataset.nativeBrowserOverlay; panel.dataset.slot = 'popover-content'; }
    if (kind === 'other-marker') panel.dataset.nativeBrowserOverlay = 'other-menu';
    if (kind === 'closed') panel.dataset.state = 'closed';
    if (kind === 'hidden') panel.hidden = true;
    if (kind === 'ancestor-hidden') { wrapper = document.createElement('div'); wrapper.hidden = true; panel.replaceWith(wrapper); wrapper.append(panel); }
    if (kind === 'display-none') panel.style.display = 'none';
    if (kind === 'invisible') panel.style.visibility = 'hidden';
    if (kind === 'transparent') panel.style.opacity = '0';
    if (kind === 'empty') rect.width = 0;
    if (kind === 'non-finite') rect.x = Number.NaN;
    if (kind === 'outside') rect.x = 800;
    try { await start(); expect(latestLayout()).toEqual({ visible: true, bounds }); }
    finally { wrapper?.remove(); }
  });

it('follows panel content resize, portal movement, host zoom and removal without changing page geometry', async () => {
  await start();
  act(() => { rect = { ...rect, y: 300, height: 360 }; notifyResize(); });
  await waitFor(() => expect(latestLayout()?.occlusions).toEqual([{ x: 300, y: 300, width: 220, height: 360 }]));
  act(() => { rect = { ...rect, x: 100 }; panel.style.transform = 'translateX(-200px)'; });
  await waitFor(() => expect(latestLayout()?.occlusions).toEqual([{ x: 100, y: 300, width: 360, height: 360 }]));
  act(() => { vi.stubGlobal('devicePixelRatio', 1.25); window.dispatchEvent(new Event('resize')); });
  await waitFor(() => expect(latestLayout()?.bounds?.pixel_ratio).toBe(1.25));
  expect(latestLayout()?.occlusions).toEqual([{ x: 100, y: 300, width: 360, height: 360 }]);
  act(() => panel.remove());
  await waitFor(() => expect(latestLayout()).toEqual({ visible: true, bounds: { ...bounds, pixel_ratio: 1.25 } }));
  expect(unobserve).toHaveBeenCalledWith(panel);
  expect(layoutCalls().every(call => call[2]?.visible === true && call[2]?.bounds?.height === 600)).toBe(true);
  expect(vi.mocked(browserCommand).mock.calls.map(call => call[1]).filter(action => action !== 'layout')).toEqual(['create']);
});

it('coalesces overlay-only changes and clears an in-flight opening when the panel closes', async () => {
  panel.dataset.state = 'closed';
  await start();
  let finish!: () => void;
  vi.mocked(browserCommand).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  act(() => { panel.dataset.state = 'open'; });
  await waitFor(() => expect(layoutCalls()).toHaveLength(2));
  for (const y of [400, 380, 360]) { act(() => { rect.y = y; notifyResize(); }); await frame(); }
  expect(layoutCalls()).toHaveLength(2);
  act(() => { panel.dataset.state = 'closed'; });
  await frame();
  await act(async () => finish());
  await waitFor(() => expect(layoutCalls()).toHaveLength(3));
  expect(latestLayout()).toEqual({ visible: true, bounds });
});

it.each(['background', 'document-hidden'])('uses only the latest occlusion after %s becomes visible again', async reason => {
  const ui = await start();
  const documentHidden = reason === 'document-hidden' ? vi.spyOn(document, 'hidden', 'get').mockReturnValue(true) : null;
  if (documentHidden) act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  else ui.rerender({ active: false });
  await waitFor(() => expect(latestLayout()).toEqual({ visible: false, bounds }));
  act(() => { rect.y = 300; notifyResize(); }); await frame();
  expect(layoutCalls()).toHaveLength(2);
  if (documentHidden) act(() => { documentHidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); });
  else ui.rerender({ active: true });
  await waitFor(() => expect(latestLayout()).toEqual({ visible: true, bounds,
    occlusions: [{ x: 300, y: 300, width: 220, height: 240 }] }));
});

it('observes a marker added to an existing element and resamples root style changes', async () => {
  delete panel.dataset.nativeBrowserOverlay;
  await start();
  expect(latestLayout()).toEqual({ visible: true, bounds });
  act(() => { panel.dataset.nativeBrowserOverlay = 'task-dock'; });
  await waitFor(() => expect(latestLayout()?.occlusions).toHaveLength(1));
  try {
    act(() => { rect.x = 200; document.documentElement.style.setProperty('--test-ui-zoom', '1.25'); });
    await waitFor(() => expect(latestLayout()?.occlusions).toEqual([{ x: 200, y: 420, width: 320, height: 240 }]));
  } finally { document.documentElement.style.removeProperty('--test-ui-zoom'); }
});

it('does not continuously schedule frames and releases observers/listeners on unmount', async () => {
  const removeListener = vi.spyOn(document, 'removeEventListener');
  const ui = await start();
  await frame();
  const settledFrames = vi.mocked(requestAnimationFrame).mock.calls.length;
  await frame(); await frame();
  expect(requestAnimationFrame).toHaveBeenCalledTimes(settledFrames);
  ui.unmount();
  await waitFor(() => expect(browserCommand).toHaveBeenLastCalledWith('test', 'close'));
  expect(disconnect).toHaveBeenCalledOnce();
  expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function), true);
  const calls = vi.mocked(browserCommand).mock.calls.length;
  act(() => { notifyResize(); panel.style.width = '400px'; document.dispatchEvent(new Event('scroll')); });
  await frame();
  expect(vi.mocked(browserCommand).mock.calls).toHaveLength(calls);
  expect(requestAnimationFrame).toHaveBeenCalledTimes(settledFrames);
});
