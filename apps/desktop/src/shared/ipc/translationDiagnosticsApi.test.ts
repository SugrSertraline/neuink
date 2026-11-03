import { beforeEach, expect, it, vi } from 'vitest';
import type { LlmProfile } from './assistantApi';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
import { testNativeTranslation } from './translationDiagnosticsApi';
beforeEach(() => { invoke.mockReset(); });
it('cancels a registration that arrives after the dialog closed without starting HTTP', async () => {
  let ready!: (id: string) => void;
  invoke.mockImplementation((command: string) => command === 'prepare_translation_model_test' ? new Promise(resolve => { ready = resolve; }) : Promise.resolve());
  const controller = new AbortController();
  const promise = testNativeTranslation({} as LlmProfile, controller.signal);
  const caught = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); ready('test-id'); await caught;
  expect(invoke.mock.calls.map(c => c[0])).toEqual(['prepare_translation_model_test', 'cancel_translation_model_test']);
});
it('cancels an in-flight native request and ignores its late success', async () => {
  let finish!: (result: unknown) => void;
  invoke.mockImplementation((command: string) => command === 'prepare_translation_model_test' ? Promise.resolve('id') : command === 'test_translation_model' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
  const controller = new AbortController(); const result = testNativeTranslation({} as LlmProfile, controller.signal);
  const caught = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(finish).toBeDefined());
  controller.abort(); finish({ ok: true }); await caught;
  expect(invoke).toHaveBeenCalledWith('cancel_translation_model_test', { testId: 'id' });
});
