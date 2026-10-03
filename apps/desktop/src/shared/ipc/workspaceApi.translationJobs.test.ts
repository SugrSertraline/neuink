import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));

beforeEach(() => { vi.resetModules(); mocks.invoke.mockReset(); });

describe('single-block translation background task', () => {
  it('wraps the actual IPC request, retaining root identity after a display subscriber closes', async () => {
    const { translateEntrySegment } = await import('./workspaceApi');
    const registry = await import('../lib/localBackgroundJobs');
    let resolve!: (value: unknown) => void;
    mocks.invoke.mockReturnValue(new Promise(done => { resolve = done; }));
    const unsubscribe = registry.subscribeLocalBackgroundJobs(vi.fn());
    const response = translateEntrySegment('library', 'paper', 'segment');
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('translate_entry_segment', {
      request: { root: 'library', entry_id: 'paper', segment_uid: 'segment' }
    });
    const running = registry.getLocalBackgroundJobs()[0];
    expect(running.id).toMatch(/^single-segment-translation:/);
    expect(running).toMatchObject({ status: 'processing', scope: { kind: 'entry', root: 'library', entry_id: 'paper' } });
    unsubscribe();
    const result = { translation: { segments: [{ segment_uid: 'segment', status: 'translated', source_text: 'private source', translated_text: 'private translation' }] } };
    resolve(result);
    await expect(response).resolves.toBe(result);
    expect(registry.getLocalBackgroundJobs()[0].status).toBe('succeeded');
    expect(JSON.stringify(registry.getLocalBackgroundJobs())).not.toContain('private');
  });

  it('preserves the original IPC rejection and never leaves a running task', async () => {
    const { translateEntrySegment } = await import('./workspaceApi');
    const registry = await import('../lib/localBackgroundJobs');
    const error = new Error('HTTP 503 provider body sk-secret');
    mocks.invoke.mockRejectedValue(error);
    await expect(translateEntrySegment('library', 'paper', 'segment')).rejects.toBe(error);
    expect(registry.getLocalBackgroundJobs()[0].status).toBe('failed');
    expect(JSON.stringify(registry.getLocalBackgroundJobs())).not.toContain('sk-secret');
  });

  it.each([null, { segments: [] }, { segments: [{ segment_uid: 'segment', status: 'failed', error: 'private error' }] },
    { segments: [{ segment_uid: 'segment', status: 'translated', translated_text: ' ' }] }])(
    'does not report an invalid or failed translated segment as successful', async translation => {
      const { translateEntrySegment } = await import('./workspaceApi');
      const registry = await import('../lib/localBackgroundJobs');
      mocks.invoke.mockResolvedValue({ translation });
      await expect(translateEntrySegment('library', 'paper', 'segment')).rejects.toThrow('未返回有效译文');
      expect(registry.getLocalBackgroundJobs()[0].status).toBe('failed');
      expect(JSON.stringify(registry.getLocalBackgroundJobs())).not.toContain('private error');
    }
  );
});
