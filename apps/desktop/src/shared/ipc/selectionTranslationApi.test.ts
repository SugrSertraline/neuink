import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { translateSelectionService, SelectionTranslationServiceError } from './selectionTranslationApi';
import { describeTranslationFailure } from '@/modules/reader/translation/translationErrorMessage';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it.each([
  ['HTTP 401 secret-body', '认证失败'], ['HTTP 429 private text', '额度不足'],
  ['HTTP 456 private text', '额度不足'], ['响应超时', '超时'], ['API Key 缺失', '配置 API Key'],
])('shows an actionable service failure without raw diagnostics: %s', async (error, expected) => {
  vi.mocked(invoke).mockRejectedValue(error);
  const caught = await translateSelectionService('source').catch(error => error);
  expect(caught).toBeInstanceOf(SelectionTranslationServiceError);
  expect(describeTranslationFailure(caught)).toContain(expected);
  expect(describeTranslationFailure(caught)).not.toMatch(/secret-body|private text/);
  expect(invoke).toHaveBeenCalledTimes(1);
});
