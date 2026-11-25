import { invoke } from '@tauri-apps/api/core';
import type { LlmProfile } from './assistantApi';
import { openPathInFileManager } from './assistantApi';

// Errors can include complete requests, credentials and model output. Extract
// bounded metadata before IPC; the native logger independently validates it.
export async function logTranslationFailure(profile: LlmProfile, stage: 'selection' | 'batch_validation' | 'context_validation' | 'connection_test', error: unknown,
  details: { elapsed_ms?: number; input_chars?: number; output_chars?: number } = {}) {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const object = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const status = typeof object.statusCode === 'number' && object.statusCode >= 400 && object.statusCode <= 599 ? object.statusCode : undefined;
  const known = raw.match(/LLM_TRANSLATION_(?:OUTPUT_LIMIT|REASONING_ONLY|CONTENT_FILTERED|PROVIDER_ERROR|INVALID_FORMAT)|TEST_(?:INCOMPLETE_TRANSLATION|CONFIGURATION|TIMEOUT)/)?.[0];
  const errorCode = status ? `HTTP_${status}` : known ?? (/timeout|timed out|超时/i.test(raw) ? 'timeout'
    : /fetch|network|connect|request/i.test(raw) ? 'network' : /empty|没有返回可用译文/i.test(raw) ? 'empty'
    : /json|schema/i.test(raw) ? 'invalid_json' : 'unknown');
  let providerError: string | undefined; let parameter: string | undefined;
  if (typeof object.responseBody === 'string' && object.responseBody.length < 64_000) {
    try {
      const failure = JSON.parse(object.responseBody)?.error;
      const code = failure?.code ?? failure?.type;
      if (['invalid_api_key', 'model_not_found', 'unsupported_parameter', 'invalid_request_error', 'rate_limit_exceeded', 'insufficient_quota', 'context_length_exceeded'].includes(code)) providerError = code;
      if (['model', 'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'messages', 'stream', 'response_format'].includes(failure?.param)) parameter = failure.param;
    } catch { /* Raw error body is never sent to the logger. */ }
  }
  try {
    await invoke('log_translation_failure', { profile, stage, errorCode, details: {
      elapsed_ms: details.elapsed_ms ?? 0, ...details, http_status: status, provider_error: providerError, rejected_parameter: parameter
    } });
    return true;
  } catch { console.warn('NeuInk: translation diagnostic log unavailable'); return false; }
}

export async function openTranslationLogs() {
  const path = await invoke<string>('translation_log_directory');
  await openPathInFileManager(path);
}
