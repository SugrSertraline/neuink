import { SelectionTranslationServiceError } from '@/shared/ipc/selectionTranslationApi';

const GENERIC_TRANSLATION_FAILURE =
  '翻译未完成，请稍后重试；若持续失败，请检查任务模型配置。';

function summarizeOriginal(message: string) {
  const trimmed = message.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return '';
  }
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

export function describeTranslationFailure(error: unknown): string {
  if (error instanceof SelectionTranslationServiceError) return error.message;
  const message = error instanceof Error ? error.message : String(error ?? '');

  let headline: string;
  // Transport-level failures carry useful detail (status code, response body),
  // so the original message is appended for diagnosis.
  let includeDetail = true;
  if (/LLM_TRANSLATION_OUTPUT_LIMIT/i.test(message)) {
    headline = '翻译输出达到模型长度上限，译文未完成。请在任务模型设置中提高最大输出长度，再重试失败部分。';
    includeDetail = false;
  } else if (/LLM_TRANSLATION_REASONING_ONLY/i.test(message)) {
    headline = '翻译模型只返回了思考过程，没有生成译文。请提高任务模型的最大输出长度，或使用支持直接回答的模型。';
    includeDetail = false;
  } else if (/LLM_TRANSLATION_CONTENT_FILTERED/i.test(message)) {
    headline = '模型服务拦截了这段内容，未完成翻译。可缩小选区后重试。';
    includeDetail = false;
  } else if (/LLM_TRANSLATION_PROVIDER_ERROR/i.test(message)) {
    headline = '模型服务返回了错误。请检查该任务模型的服务状态、余额及调用权限后重试。';
    includeDetail = false;
  } else if (/LLM_TRANSLATION_INVALID_FORMAT|JSON object|EOF while parsing|missing field|expected .* at line|invalid (type|escape)|repair attempt failed/i.test(message)) {
    headline = '模型已响应，但译文格式不完整或不符合要求，暂时无法保存。请重试失败部分；若持续失败，请更换任务模型。';
    includeDetail = false;
  } else if (/配置.*(翻译)?模型|configure.*model|no .*profile/i.test(message)) {
    headline = '请先在设置中配置任务模型，再使用翻译功能。';
    includeDetail = false;
  } else if (/\b(401|403)\b|unauthori[sz]ed|forbidden|api[ _-]?key|authentication/i.test(message)) {
    headline = '翻译模型认证失败，请检查任务模型的 API Key 和服务地址。';
  } else if (/\b404\b|not found/i.test(message)) {
    headline = '翻译接口路径不存在（404）：请检查 Base URL 是否缺少 /v1 等前缀，或该服务不提供 /chat/completions。';
  } else if (/\b400\b|bad request/i.test(message)) {
    headline = '翻译请求被服务端拒绝（400）：可能是模型 ID 不正确，或该模型不支持请求中的参数（如 max_tokens）。';
  } else if (/\b429\b|rate.?limit/i.test(message)) {
    headline = '翻译请求被限流（429），请稍后重试。';
  } else if (/\b5\d\d\b|internal server error/i.test(message)) {
    headline = '翻译模型服务端错误，请检查本地模型服务的日志。';
  } else if (/did not contain (message content|text)|empty content|stream ended without content|没有返回可用译文|空的整段译文/i.test(message)) {
    headline = '翻译模型返回了空内容：可能是模型 ID 不存在、接口协议不匹配，或该模型只输出思考过程。';
    includeDetail = false;
  } else if (/timeout|timed out|超时/i.test(message)) {
    headline = '翻译模型响应超时，请稍后重试。';
  } else if (/network|connection|connect|fetch|error sending request|error decoding response|网络|连接/i.test(message)) {
    headline = '暂时无法连接翻译模型，请检查网络和模型服务状态。';
    includeDetail = false;
  } else {
    // Low-level model-output errors are not actionable for users.
    headline = GENERIC_TRANSLATION_FAILURE;
    includeDetail = false;
  }

  const detail = includeDetail ? summarizeOriginal(message) : '';
  return detail ? `${headline}（${detail}）` : headline;
}

export const PARTIAL_TRANSLATION_FAILURE =
  '部分内容未翻译完成，可在翻译任务中重试失败部分。';
