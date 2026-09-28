// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { CATALOG_TTL, loadPublicModelCatalog, readPublicModelCatalog, resetPublicCatalogMemory } from './modelCatalogStore';
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
const key = 'neuink.publicModelCatalog.v1';
const dev = { example: { name: 'Example', api: 'https://models.example', models: { chat: { limit: { context: 128000, output: 8192 } } } } };
const router = { data: [{ id: 'other/chat', context_length: 32000 }] };
const fetchMock = vi.mocked(nativeFetch);
function respond() {
  fetchMock.mockImplementation(async input => new Response(JSON.stringify(String(input).includes('models.dev') ? dev : router)));
}
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); resetPublicCatalogMemory(); fetchMock.mockReset(); respond(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('public catalog loading and cache', () => {
  it('uses only fixed public URLs, no credentials, then reuses the daily cache', async () => {
    const result = await loadPublicModelCatalog();
    expect(result.models).toHaveLength(2); expect(result.warnings).toEqual([]);
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['https://models.dev/api.json', 'https://openrouter.ai/api/v1/models']);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({ credentials: 'omit', redirect: 'error' }); expect(options?.headers).toBeUndefined();
    }
    resetPublicCatalogMemory();
    expect((await loadPublicModelCatalog()).models).toHaveLength(2); expect(fetchMock).toHaveBeenCalledTimes(2);
    await loadPublicModelCatalog(undefined, true); expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('refreshes expired records and retains old data with a warning when offline', async () => {
    const old = await loadPublicModelCatalog();
    old.updatedAt = new Date(Date.now() - CATALOG_TTL - 1).toISOString();
    fetchMock.mockRejectedValue(new Error('offline'));
    const fallback = await loadPublicModelCatalog();
    expect(fallback.models).toEqual(old.models); expect(fallback.updatedAt).toBe(old.updatedAt); expect(fallback.warnings).toHaveLength(2);
  });
  it('retains the unavailable source while replacing a successful source, including after reload', async () => {
    await loadPublicModelCatalog();
    fetchMock.mockImplementation(async input => {
      if (String(input).includes('openrouter')) throw new Error('offline');
      return new Response(JSON.stringify({ example: { models: { newer: { limit: { context: 1000000 } } } } }));
    });
    const result = await loadPublicModelCatalog(undefined, true);
    expect(result.models.map(m => m.id)).toEqual(['newer', 'other/chat']); expect(result.warnings).toHaveLength(1);
    resetPublicCatalogMemory(); expect(readPublicModelCatalog()?.warnings).toEqual(result.warnings);
  });
  it('rejects malformed cache and oversized/error responses without saving an empty catalog', async () => {
    localStorage.setItem(key, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), models: [{ id: 'bad', providerId: 'x', providerName: 'X', maxContextLength: -1 }] }));
    expect(readPublicModelCatalog()).toBeUndefined();
    fetchMock.mockResolvedValueOnce(new Response('{}', { headers: { 'content-length': '999999999' } })).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(loadPublicModelCatalog()).rejects.toThrow('公开模型目录暂不可用');
    expect(readPublicModelCatalog()).toBeUndefined();
  });
  it('works in memory when local storage is full', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const result = await loadPublicModelCatalog();
    expect(result.models).toHaveLength(2); expect(result.warnings.join()).toContain('缓存空间不足');
    expect(readPublicModelCatalog()).toBe(result);
  });
  it('aborts outstanding transports and never caches a canceled request', async () => {
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const controller = new AbortController(); const promise = loadPublicModelCatalog(controller.signal);
    controller.abort(); await expect(promise).rejects.toThrow();
    expect(fetchMock.mock.calls.every(([,options]) => options?.signal?.aborted)).toBe(true);
    expect(readPublicModelCatalog()).toBeUndefined();
  });
  it('bounds hung requests with a timeout and clears timers', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('timeout')))));
    const promise = loadPublicModelCatalog(); const assertion = expect(promise).rejects.toThrow('公开模型目录暂不可用');
    await vi.advanceTimersByTimeAsync(12001); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
