import { beforeEach, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { listenBrowser } from './browserApi';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it('forwards native popup requests separately from source navigation and releases all subscriptions', async () => {
  const stops = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  stops.forEach(stop => vi.mocked(listen).mockResolvedValueOnce(stop));
  const callback = vi.fn();
  const stop = await listenBrowser(callback);
  expect(vi.mocked(listen).mock.calls.map(call => call[0])).toEqual([
    'neuink:browser-state', 'neuink:browser-focus', 'neuink:browser-open-tab', 'neuink:browser-zoom'
  ]);
  const receive = vi.mocked(listen).mock.calls[2][1];
  receive({ event: 'neuink:browser-open-tab', id: 1,
    payload: { id: 'source', request_id: 'request-one', url: 'https://example.org/new' } });
  expect(callback).toHaveBeenLastCalledWith({ id: 'source', url: null, title: null, loading: null, error: null,
    openTab: { requestId: 'request-one', url: 'https://example.org/new', error: undefined } });
  receive({ event: 'neuink:browser-open-tab', id: 2,
    payload: { id: 'source', request_id: 'request-two', error: '请稍后再次点击链接。' } });
  expect(callback.mock.lastCall?.[0]).toMatchObject({ error: null,
    openTab: { requestId: 'request-two', error: '请稍后再次点击链接。' } });
  vi.mocked(listen).mock.calls[3][1]({ event: 'neuink:browser-zoom', id: 3, payload: { id: 'source', zoom: 1.25 } });
  expect(callback).toHaveBeenLastCalledWith({ id: 'source', zoom: 1.25, url: null, title: null, loading: null, error: null });
  stop(); stop();
  stops.forEach(unlisten => expect(unlisten).toHaveBeenCalledOnce());
});

it.each([0, 1, 2, 3])('releases earlier subscriptions if registration %i fails', async failedIndex => {
  const stops = Array.from({ length: failedIndex }, () => vi.fn());
  stops.forEach(stop => vi.mocked(listen).mockResolvedValueOnce(stop));
  vi.mocked(listen).mockRejectedValueOnce(new Error('listener unavailable'));
  await expect(listenBrowser(vi.fn())).rejects.toThrow('listener unavailable');
  stops.forEach(stop => expect(stop).toHaveBeenCalledOnce());
});
