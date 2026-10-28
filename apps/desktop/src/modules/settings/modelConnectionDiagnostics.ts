import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { testNativeTranslation } from '@/shared/ipc/translationDiagnosticsApi';
import { translateSelectionWithProfile } from '@/modules/reader/translation/modelSelectionTranslation';
import { describeTranslationFailure } from '@/modules/reader/translation/translationErrorMessage';
import { logTranslationFailure } from '@/shared/ipc/translationLogApi';

export type DiagnosticStep = { label: string; status: 'pending' | 'testing' | 'success' | 'error' | 'cancelled'; message?: string; code?: string; elapsedMs?: number };
export const initialDiagnosticSteps = (): DiagnosticStep[] => [
  { label: '选中文字翻译', status: 'pending' }, { label: '片段与批量翻译', status: 'pending' }
];

// Cancel the UI promptly even if an HTTP/IPC adapter is slow to acknowledge abort.
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
const messages: Record<string, string> = {
  TEST_CONFIGURATION: '请填写有效的服务地址、模型 ID 和数值参数。',
  TEST_INCOMPLETE_TRANSLATION: '模型没有完整返回中文译文，或片段编号、公式保留检查未通过。请检查模型能力后重试。',
  TEST_RESPONSE_FORMAT: '模型响应格式不符合翻译要求，请检查接口协议和模型后重试。',
  TEST_NETWORK: '无法连接模型服务，请检查服务地址、网络、代理及证书。',
  TEST_TIMEOUT: '测试等待超过 90 秒，请检查服务状态或模型输出设置后重试。',
  TEST_EMPTY_RESPONSE: '模型没有返回译文，请检查模型与最大输出长度。',
  TEST_BUSY: '已有较多翻译测试正在运行，请稍后重试。',
  TEST_FAILED: '测试未完成，请检查服务地址与模型配置后重试。'
};

export function diagnosticFailure(error: unknown) {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
  const http = typeof status === 'number' && status >= 400 && status <= 599 ? status : Number(raw.match(/^HTTP_(\d{3})$/)?.[1]);
  let code = http ? `HTTP_${http}` : Object.keys(messages).find(key => raw === key);
  code ??= raw.match(/LLM_TRANSLATION_(OUTPUT_LIMIT|REASONING_ONLY|CONTENT_FILTERED|PROVIDER_ERROR|INVALID_FORMAT)/)?.[0];
  if (!code) code = /timeout|timed out|超时/i.test(raw) ? 'TEST_TIMEOUT'
    : /network|fetch|sending request|connect/i.test(raw) ? 'TEST_NETWORK'
    : /没有返回可用译文|empty/i.test(raw) ? 'TEST_EMPTY_RESPONSE' : 'TEST_FAILED';
  return { code, message: messages[code] ?? describeTranslationFailure(http ? `HTTP ${http}` : code) };
}

export async function runModelDiagnostics(profile: LlmProfile, signal: AbortSignal, update: (steps: DiagnosticStep[]) => void) {
  const steps = initialDiagnosticSteps();
  const validUrl = (() => { try { return ['http:', 'https:'].includes(new URL(profile.base_url).protocol); } catch { return false; } })();
  if (!validUrl || !profile.model.trim() || [profile.max_context_length, profile.max_output_tokens].some(v => v != null && (!Number.isInteger(v) || v <= 0))
    || [profile.temperature, profile.top_p].some(v => v != null && !Number.isFinite(v))) {
    const failure = diagnosticFailure('TEST_CONFIGURATION');
    steps.forEach(step => Object.assign(step, { status: 'error', ...failure })); update([...steps]); return steps;
  }
  for (let index = 0; index < steps.length; index++) {
    signal.throwIfAborted();
    const started = performance.now();
    steps[index] = { ...steps[index], status: 'testing' }; update([...steps]);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
    try {
      if (index === 0) {
        const text = await abortable(translateSelectionWithProfile(profile, { entryTitle: 'Translation connection test',
          sourceText: 'The model predicts traffic flow using historical observations.' }, { signal: controller.signal, maxRetries: 0 }), controller.signal);
        if (!/[\u4e00-\u9fff]/.test(text)) throw new Error('TEST_INCOMPLETE_TRANSLATION');
      } else {
        const result = await abortable(testNativeTranslation(profile, controller.signal), controller.signal);
        if (!result.ok) throw new Error(result.code);
      }
      signal.throwIfAborted();
      if (timedOut) throw new Error('TEST_TIMEOUT');
      steps[index] = { ...steps[index], status: 'success', code: 'OK',
        message: index === 0 ? '模型已返回中文译文，选区调用通过。' : '两段译文已返回；结果格式、片段编号和公式保留检查通过。' };
    } catch (error) {
      signal.throwIfAborted();
      steps[index] = { ...steps[index], status: 'error', ...diagnosticFailure(timedOut ? 'TEST_TIMEOUT' : error) };
      // Network/model errors are logged by their real translation route. Record
      // failures originating in this checker (timeout/acceptance) separately.
      if (timedOut || error instanceof Error && error.message === 'TEST_INCOMPLETE_TRANSLATION') {
        await logTranslationFailure(profile, 'connection_test', timedOut ? 'TEST_TIMEOUT' : error,
          { elapsed_ms: Math.round(performance.now() - started) });
      }
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
    steps[index].elapsedMs = Math.round(performance.now() - started); update([...steps]);
  }
  return steps;
}

export function diagnosticReport(profile: LlmProfile, steps: DiagnosticStep[]) {
  let host = '地址无效'; try { host = new URL(profile.base_url).host; } catch { /* Never include raw URLs. */ }
  const report = ['NeuInk 连接与翻译测试', `时间：${new Date().toISOString()}`, `模型：${profile.model}`,
    `服务：${host}`, `协议：${profile.api_protocol}`, `最大输出：${profile.max_output_tokens ?? '默认'}`,
    ...steps.map(s => `${s.label}：${s.status} / ${s.code ?? '—'} / ${s.elapsedMs ?? 0} ms\n${s.message ?? ''}`)].join('\n');
  return profile.api_key ? report.split(profile.api_key).join('[已隐藏]') : report;
}
