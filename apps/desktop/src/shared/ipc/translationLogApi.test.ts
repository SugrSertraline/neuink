import { beforeEach, expect, it, vi } from 'vitest';
import type { LlmProfile } from './assistantApi';
const mock = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mock.invoke }));
vi.mock('./assistantApi', () => ({ openPathInFileManager: mock.open }));
import { logTranslationFailure, openTranslationLogs } from './translationLogApi';
beforeEach(() => { vi.resetAllMocks(); mock.invoke.mockResolvedValue(undefined); });
it('extracts error metadata without sending raw response bodies to logging', async () => {
  const error = Object.assign(new Error('private paper secret-key'), { statusCode: 400, responseBody: JSON.stringify({ error: { code: 'unsupported_parameter', param: 'temperature', message: 'private paper secret-key' } }) });
  await logTranslationFailure({ model: 'test' } as LlmProfile, 'selection', error, { elapsed_ms: 123 });
  const payload = mock.invoke.mock.calls[0][1];
  expect(payload.details).toMatchObject({ elapsed_ms: 123, http_status: 400, provider_error: 'unsupported_parameter', rejected_parameter: 'temperature' });
  expect(JSON.stringify(payload)).not.toMatch(/private paper|secret-key|responseBody/);
});
it('does not mask the original failure if logging is unavailable', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  mock.invoke.mockRejectedValue(new Error('private filesystem path'));
  await expect(logTranslationFailure({} as LlmProfile, 'selection', new Error('LLM_TRANSLATION_INVALID_FORMAT'))).resolves.toBe(false);
  expect(warn).toHaveBeenCalledWith('NeuInk: translation diagnostic log unavailable'); warn.mockRestore();
});
it('opens the native configured log directory without accepting arbitrary UI paths', async () => {
  mock.invoke.mockResolvedValue('fixture/logs'); await openTranslationLogs();
  expect(mock.invoke).toHaveBeenCalledWith('translation_log_directory'); expect(mock.open).toHaveBeenCalledWith('fixture/logs');
});
