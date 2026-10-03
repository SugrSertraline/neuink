// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { BROWSER_OPEN_EVENT, requestBrowserTab } from './browserUrl';

it('keeps ordinary link events compatible and carries native source/request identity only when provided', () => {
  const receive = vi.fn();
  window.addEventListener(BROWSER_OPEN_EVENT, receive);
  try {
    requestBrowserTab('example.org');
    expect((receive.mock.calls[0][0] as CustomEvent).detail).toBe('https://example.org/');
    requestBrowserTab('example.org/next', { sourceId: 'source', requestId: 'request' });
    expect((receive.mock.calls[1][0] as CustomEvent).detail)
      .toEqual({ url: 'https://example.org/next', sourceId: 'source', requestId: 'request' });
    expect(() => requestBrowserTab('javascript:alert(1)', { sourceId: 'source', requestId: 'bad' })).toThrow();
    expect(receive).toHaveBeenCalledTimes(2);
  } finally { window.removeEventListener(BROWSER_OPEN_EVENT, receive); }
});
