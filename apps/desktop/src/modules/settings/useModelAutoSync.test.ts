// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useModelAutoSync } from './useModelAutoSync';
const connection = { open: true, baseUrl: 'https://example.test/v1', apiKey: 'synthetic-key', apiProtocol: 'openai_compatible' as const };
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

it('debounces credentials and does not retrigger on callback rerenders', async () => {
  const sync = vi.fn().mockResolvedValue(undefined);
  const { result, rerender } = renderHook(props => useModelAutoSync(props), { initialProps: { ...connection, sync } });
  await tick(500);
  rerender({ ...connection, apiKey: 'synthetic-new-key', sync });
  await tick(799); expect(sync).not.toHaveBeenCalled();
  await tick(1); expect(sync).toHaveBeenCalledTimes(1); expect(result.current.status).toBe('success');
  rerender({ ...connection, apiKey: 'synthetic-new-key', sync: vi.fn() });
  await tick(1000); expect(result.current.status).toBe('success');
});

it('waits for credentials on remote hosts, allows local without key, and skips closed/unsafe addresses', async () => {
  const sync = vi.fn().mockResolvedValue(undefined);
  const { rerender } = renderHook(props => useModelAutoSync(props), { initialProps: { ...connection, apiKey: '', sync } });
  await tick(1000); expect(sync).not.toHaveBeenCalled();
  rerender({ ...connection, apiKey: '', baseUrl: 'http://localhost:11434/v1', sync });
  await tick(800); expect(sync).toHaveBeenCalledTimes(1);
  for (const baseUrl of ['not-a-url', 'http://remote.example/v1', 'https://example.test/v1?key=secret']) {
    rerender({ ...connection, baseUrl, sync }); await tick(1000);
  }
  rerender({ ...connection, open: false, sync }); await tick(1000);
  expect(sync).toHaveBeenCalledTimes(1);
});

it('does not loop on failure, redacts arbitrary errors, and retries explicitly', async () => {
  const sync = vi.fn().mockRejectedValueOnce(new Error('HTTP 403 secret-key private-data')).mockResolvedValue(undefined);
  const { result } = renderHook(() => useModelAutoSync({ ...connection, sync }));
  await tick(800); expect(result.current.status).toBe('error');
  expect(result.current.message).toContain('403'); expect(result.current.message).not.toContain('secret-key');
  await tick(60000); expect(sync).toHaveBeenCalledTimes(1);
  act(() => result.current.retry()); await tick(800);
  expect(sync).toHaveBeenCalledTimes(2); expect(result.current.status).toBe('success');
});

it('aborts obsolete requests and ignores their late failures', async () => {
  let rejectOld!: (reason: Error) => void;
  const sync = vi.fn().mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectOld = reject; })).mockResolvedValue(undefined);
  const { result, rerender, unmount } = renderHook(props => useModelAutoSync(props), { initialProps: { ...connection, sync } });
  await tick(800);
  const oldSignal = sync.mock.calls[0][0] as AbortSignal;
  rerender({ ...connection, baseUrl: 'https://other.example/v1', sync });
  expect(oldSignal.aborted).toBe(true);
  await tick(800); expect(result.current.status).toBe('success');
  await act(async () => rejectOld(new Error('HTTP 403')));
  expect(result.current.status).toBe('success');
  unmount(); expect(vi.getTimerCount()).toBe(0);
});

it('cancels on close and times out even if transport ignores abort', async () => {
  const sync = vi.fn(() => new Promise<void>(() => {}));
  const { result, rerender, unmount } = renderHook(props => useModelAutoSync(props), { initialProps: { ...connection, sync } });
  await tick(20800); expect(result.current.status).toBe('error');
  expect(result.current.message).toContain('超时');
  rerender({ ...connection, open: false, sync }); expect(result.current.status).toBe('idle');
  unmount(); expect(vi.getTimerCount()).toBe(0);
});
