import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { readBrowserTab, type BrowserTabSnapshot, type BrowserTabTarget } from './browserApi';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const target: BrowserTabTarget = { id: 'tab-one', url: 'https://example.org/article?access=private',
  title: 'Article', navigationId: 'document-one' };
const snapshot: BrowserTabSnapshot = { title: 'Article', url: 'https://example.org/article',
  text: 'Rendered article', selection: '', truncated: false, capturedAt: '2026-10-03T00:00:00Z', limitations: [] };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(isTauri).mockReturnValue(true); });

describe('readBrowserTab native boundary', () => {
  it('uses only the captured document identity without a model supplied URL or network fallback', async () => {
    vi.mocked(invoke).mockResolvedValue(snapshot);
    await expect(readBrowserTab(target)).resolves.toEqual(snapshot);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('read_browser_tab', { request: {
      id: 'tab-one', expected_url: target.url, expected_navigation_id: 'document-one', call_id: expect.any(String), selection_only: false
    } });
  });

  it('fails explicitly in a plain browser without invoking native commands', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(readBrowserTab(target)).rejects.toThrow('仅在 NeuInk 桌面端可用');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not start an already aborted read', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(readBrowserTab(target, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('settles cancellation immediately, releases its listener and discards a late native result', async () => {
    let finish!: (value: BrowserTabSnapshot) => void;
    vi.mocked(invoke).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const read = readBrowserTab(target, abort.signal);
    abort.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    finish(snapshot);
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('cancel_browser_read', { callId: expect.any(String) });
  });

  it.each(['success', 'failure'])('removes abort listeners after native %s', async state => {
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    if (state === 'success') vi.mocked(invoke).mockResolvedValue(snapshot);
    else vi.mocked(invoke).mockRejectedValue(new Error('网页已关闭'));
    const read = readBrowserTab(target, abort.signal);
    if (state === 'success') await expect(read).resolves.toEqual(snapshot);
    else await expect(read).rejects.toThrow('网页已关闭');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(invoke).toHaveBeenCalledOnce();
  });
});
