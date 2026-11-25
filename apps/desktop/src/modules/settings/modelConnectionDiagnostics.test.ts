import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/shared/ipc/translationLogApi', () => ({ logTranslationFailure: vi.fn(async () => true) }));
import type { LlmProfile } from '@/shared/ipc/assistantApi';
const mocks = vi.hoisted(() => ({ selection: vi.fn(), native: vi.fn() }));
vi.mock('@/modules/reader/translation/modelSelectionTranslation', () => ({ translateSelectionWithProfile: mocks.selection }));
vi.mock('@/shared/ipc/translationDiagnosticsApi', () => ({ testNativeTranslation: mocks.native }));
import { diagnosticFailure, diagnosticReport, runModelDiagnostics } from './modelConnectionDiagnostics';

const profile: LlmProfile = { id: 'p', name: 'test', model: 'model', base_url: 'https://service.test/v1?secret=private', api_key: 'secret-key', api_protocol: 'openai_compatible', max_context_length: null, max_output_tokens: null, temperature: null, top_p: null };
beforeEach(() => { vi.resetAllMocks(); mocks.selection.mockResolvedValue('模型根据历史观测预测交通流量。'); mocks.native.mockResolvedValue({ ok: true, code: 'OK' }); });
afterEach(() => vi.useRealTimers());
describe('real translation connection diagnostics', () => {
  it('requires both real translation routes and sends a fixed sample with current configuration', async () => {
    const update = vi.fn();
    const steps = await runModelDiagnostics(profile, new AbortController().signal, update);
    expect(steps.map(s => s.status)).toEqual(['success', 'success']);
    expect(mocks.selection).toHaveBeenCalledWith(profile, expect.objectContaining({ sourceText: 'The model predicts traffic flow using historical observations.' }), expect.objectContaining({ maxRetries: 0, signal: expect.any(AbortSignal) }));
    expect(mocks.native).toHaveBeenCalledWith(profile, expect.any(AbortSignal));
    expect(update.mock.calls[0][0][0].status).toBe('testing');
  });
  it('continues native diagnosis after a selected-text authentication failure without exposing the response', async () => {
    mocks.selection.mockRejectedValue(Object.assign(new Error('private response secret-key'), { statusCode: 401 }));
    const steps = await runModelDiagnostics(profile, new AbortController().signal, vi.fn());
    expect(steps.map(s => s.status)).toEqual(['error', 'success']);
    expect(steps[0].code).toBe('HTTP_401');
    const report = diagnosticReport(profile, steps);
    expect(report).toContain('service.test'); expect(report).toContain('HTTP_401');
    for (const secret of ['private', 'secret-key', '?secret', '/v1']) expect(report).not.toContain(secret);
  });
  it('rejects echoed English and explains a native format failure', async () => {
    mocks.selection.mockResolvedValue('The model predicts traffic flow.');
    mocks.native.mockResolvedValue({ ok: false, code: 'LLM_TRANSLATION_INVALID_FORMAT' });
    const steps = await runModelDiagnostics(profile, new AbortController().signal, vi.fn());
    expect(steps.map(s => s.status)).toEqual(['error', 'error']);
    expect(steps[0].code).toBe('TEST_INCOMPLETE_TRANSLATION');
    expect(steps[1].message).toContain('译文格式');
  });
  it.each([{ model: '' }, { base_url: 'file:///secret' }, { max_output_tokens: -1 }, { temperature: NaN }])('rejects invalid draft before sending requests: %o', async invalid => {
    const steps = await runModelDiagnostics({ ...profile, ...invalid }, new AbortController().signal, vi.fn());
    expect(steps.every(s => s.code === 'TEST_CONFIGURATION')).toBe(true);
    expect(mocks.selection).not.toHaveBeenCalled(); expect(mocks.native).not.toHaveBeenCalled();
  });
  it('cancels promptly and does not start the next route even if the adapter hangs', async () => {
    mocks.selection.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController(); const update = vi.fn();
    const result = runModelDiagnostics(profile, controller.signal, update);
    const caught = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await caught;
    expect(mocks.selection.mock.calls[0][2].signal.aborted).toBe(true);
    expect(mocks.native).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledTimes(1);
  });
  it('times out a stalled adapter and still checks the other route', async () => {
    vi.useFakeTimers(); mocks.selection.mockReturnValue(new Promise(() => {}));
    const result = runModelDiagnostics(profile, new AbortController().signal, vi.fn());
    await vi.advanceTimersByTimeAsync(90_000);
    const steps = await result;
    expect(steps[0].code).toBe('TEST_TIMEOUT'); expect(steps[1].status).toBe('success');
  });
  it('only reports fixed diagnostic text and redacts keys accidentally used as model names', () => {
    expect(diagnosticFailure(new Error('unknown private body secret-key')).message).not.toContain('private');
    expect(diagnosticReport({ ...profile, model: profile.api_key! }, [])).not.toContain('secret-key');
  });
});
