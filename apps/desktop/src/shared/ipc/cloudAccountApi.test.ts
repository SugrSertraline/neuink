import { beforeEach, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => { vi.resetModules(); invoke.mockReset(); });
it('projects maintenance for its full lifetime without recording request tokens', async () => {
  const { cloudAccount } = await import('./cloudAccountApi');
  const { getLocalBackgroundJobs } = await import('../lib/localBackgroundJobs');
  let finish!: () => void;
  invoke.mockReturnValue(new Promise<void>(done => { finish = done; }));
  const result = cloudAccount({ action: 'storage_cleanup', token: 'private-token' });
  expect(getLocalBackgroundJobs()[0]).toMatchObject({ status: 'processing', scope: null });
  expect(JSON.stringify(getLocalBackgroundJobs())).not.toContain('private-token');
  finish(); await result;
  expect(getLocalBackgroundJobs()[0].status).toBe('succeeded');
});
it('does not create duplicate jobs for auto-sync polling and propagates maintenance failures', async () => {
  const { cloudAccount } = await import('./cloudAccountApi');
  const { getLocalBackgroundJobs } = await import('../lib/localBackgroundJobs');
  invoke.mockResolvedValueOnce({});
  await cloudAccount({ action: 'sync_auto', root: 'A' });
  expect(getLocalBackgroundJobs()).toEqual([]);
  invoke.mockRejectedValueOnce(new Error('HTTP 403 private-token'));
  await expect(cloudAccount({ action: 'sync_resolve', root: 'A', id: 'conflict', token: 'private-token', keep_local: true })).rejects.toThrow();
  expect(getLocalBackgroundJobs()[0]).toMatchObject({ status: 'failed', scope: { kind: 'workspace', root: 'A' } });
  expect(JSON.stringify(getLocalBackgroundJobs())).not.toContain('private-token');
});
