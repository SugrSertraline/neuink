import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), generate: vi.fn() }));
vi.mock('@/shared/ipc/assistantApi', () => ({ getLlmSettings: mocks.settings }));
vi.mock('ai', () => ({ generateText: mocks.generate }));
vi.mock('../../assistant/sdk/provider', () => ({ createNeuinkModel: () => 'model', generationSettings: () => ({}) }));

const request = { root: 'library', entryId: 'paper', entryTitle: '论文', text: 'Private selected source', context: 'Private paragraph context' };
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ translation_profile: { max_context_length: 8192 } });
});

describe('selection translation task lifecycle', () => {
  it('tracks the same model request after subscribers close and does not copy selected text into task records', async () => {
    const { translateTextSelection } = await import('./entryTranslation');
    const registry = await import('@/shared/lib/localBackgroundJobs');
    let resolve!: (value: { text: string }) => void;
    mocks.generate.mockReturnValue(new Promise(done => { resolve = done; }));
    const unsubscribe = registry.subscribeLocalBackgroundJobs(vi.fn());
    const response = translateTextSelection(request);
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
    expect(registry.getLocalBackgroundJobs()[0]).toMatchObject({ status: 'processing', scope: { kind: 'entry', root: 'library', entry_id: 'paper' } });
    expect(JSON.stringify(registry.getLocalBackgroundJobs())).not.toContain('Private');
    unsubscribe();
    expect(registry.getLocalBackgroundJobs()[0].status).toBe('processing');
    resolve({ text: '  选区译文  ' });
    await expect(response).resolves.toBe('选区译文');
    expect(registry.getLocalBackgroundJobs()[0].status).toBe('succeeded');
    expect(JSON.stringify(registry.getLocalBackgroundJobs())).not.toContain('选区译文');
  });

  it.each(['missing model', 'empty response', 'provider error'])('terminates task on %s and leaves the original retry flow in charge', async scenario => {
    const { translateTextSelection } = await import('./entryTranslation');
    const registry = await import('@/shared/lib/localBackgroundJobs');
    if (scenario === 'missing model') mocks.settings.mockResolvedValue({ translation_profile: null });
    if (scenario === 'empty response') mocks.generate.mockResolvedValue({ text: ' ' });
    if (scenario === 'provider error') mocks.generate.mockRejectedValue(new Error('HTTP 403 secret response sk-secret'));
    await expect(translateTextSelection(request)).rejects.toThrow();
    expect(registry.getLocalBackgroundJobs()).toHaveLength(1);
    expect(registry.getLocalBackgroundJobs()[0].status).toBe('failed');
    expect(JSON.stringify(registry.getLocalBackgroundJobs())).not.toContain('sk-secret');
  });

  it('does not start a task or model call for an empty selection', async () => {
    const { translateTextSelection } = await import('./entryTranslation');
    const registry = await import('@/shared/lib/localBackgroundJobs');
    await expect(translateTextSelection({ ...request, text: '  ' })).rejects.toThrow('没有可翻译的文字');
    expect(registry.getLocalBackgroundJobs()).toEqual([]);
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});
