const GENERIC_TRANSLATION_FAILURE =
  '翻译模型未返回可用结果，请稍后重试；若持续失败，请检查任务模型配置。';

export function describeTranslationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');

  if (/配置.*(翻译)?模型|configure.*model|no .*profile/i.test(message)) {
    return '请先在设置中配置任务模型，再使用翻译功能。';
  }
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|api[ _-]?key|authentication/i.test(message)) {
    return '翻译模型认证失败，请检查任务模型的 API Key 和服务地址。';
  }
  if (/timeout|timed out|超时/i.test(message)) {
    return '翻译模型响应超时，请稍后重试。';
  }
  if (/network|connection|connect|fetch|网络|连接/i.test(message)) {
    return '暂时无法连接翻译模型，请检查网络和模型服务状态。';
  }

  return GENERIC_TRANSLATION_FAILURE;
}

export const PARTIAL_TRANSLATION_FAILURE =
  '部分内容未翻译完成，可在翻译任务中重试失败部分。';
