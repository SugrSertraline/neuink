import { invoke } from '@tauri-apps/api/core';
import type { LlmProfile } from './assistantApi';

export async function testNativeTranslation(profile: LlmProfile, signal: AbortSignal) {
  signal.throwIfAborted();
  const testId = await invoke<string>('prepare_translation_model_test');
  const cancel = () => { void invoke('cancel_translation_model_test', { testId }).catch(() => undefined); };
  if (signal.aborted) { cancel(); signal.throwIfAborted(); }
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await invoke<{ ok: boolean; code: string }>('test_translation_model', { testId, profile });
    signal.throwIfAborted();
    return result;
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}
