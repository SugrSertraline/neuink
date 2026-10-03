import { beforeEach, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { browserCommand, listenBrowser } from './browserApi';
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it('forwards native focus without trusting page scripts and releases all subscriptions', async () => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const stops = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  vi.mocked(listen).mockImplementation(async (name, handler) => {
    handlers.set(String(name), handler as (event: { payload: unknown }) => void);
    return stops[handlers.size - 1];
  });
  const receive = vi.fn(); const stop = await listenBrowser(receive);
  expect([...handlers.keys()]).toEqual(['neuink:browser-state', 'neuink:browser-focus', 'neuink:browser-open-tab', 'neuink:browser-zoom']);
  handlers.get('neuink:browser-focus')!({ payload: 'browser-id' });
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ id: 'browser-id', focused: true }));
  stop(); stops.forEach(fn => expect(fn).toHaveBeenCalledOnce());
});
it('sends native zoom independently of navigation and layout', async () => {
  vi.mocked(invoke).mockResolvedValue(undefined);
  await browserCommand('browser-id', 'zoom', { zoom: 1.25 });
  expect(invoke).toHaveBeenCalledExactlyOnceWith('browser_command', { request: { id: 'browser-id', action: 'zoom', zoom: 1.25 } });
});
it('forwards optional host-coordinate occlusions without changing native page bounds', async () => {
  const bounds = { x: 20, y: 80, width: 500, height: 600, pixel_ratio: 1.875 };
  const occlusions = [{ x: 296, y: 416, width: 224, height: 248 }];
  await browserCommand('browser-id', 'layout', { visible: true, bounds, occlusions });
  expect(invoke).toHaveBeenLastCalledWith('browser_command', { request: { id: 'browser-id', action: 'layout', visible: true, bounds, occlusions } });
  await browserCommand('browser-id', 'layout', { visible: true, bounds });
  expect(invoke).toHaveBeenLastCalledWith('browser_command', { request: { id: 'browser-id', action: 'layout', visible: true, bounds } });
});
it('unsubscribes state if focus subscription fails', async () => {
  const stop = vi.fn(); vi.mocked(listen).mockResolvedValueOnce(stop).mockRejectedValueOnce(new Error('closed'));
  await expect(listenBrowser(vi.fn())).rejects.toThrow('closed');
  expect(stop).toHaveBeenCalledOnce();
});
