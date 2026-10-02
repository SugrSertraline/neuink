import { beforeEach, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { listenBrowser } from './browserApi';
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
it('forwards native focus without trusting page scripts and releases both subscriptions', async () => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const stops = [vi.fn(), vi.fn()];
  vi.mocked(listen).mockImplementation(async (name, handler) => {
    handlers.set(String(name), handler as (event: { payload: unknown }) => void);
    return stops[handlers.size - 1];
  });
  const receive = vi.fn(); const stop = await listenBrowser(receive);
  handlers.get('neuink:browser-focus')!({ payload: 'browser-id' });
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ id: 'browser-id', focused: true }));
  stop(); stops.forEach(fn => expect(fn).toHaveBeenCalledOnce());
});
it('unsubscribes state if focus subscription fails', async () => {
  const stop = vi.fn(); vi.mocked(listen).mockResolvedValueOnce(stop).mockRejectedValueOnce(new Error('closed'));
  await expect(listenBrowser(vi.fn())).rejects.toThrow('closed');
  expect(stop).toHaveBeenCalledOnce();
});
