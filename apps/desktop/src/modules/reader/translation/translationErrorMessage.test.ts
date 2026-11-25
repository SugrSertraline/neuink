import { describe, expect, it } from 'vitest';

import { describeTranslationFailure } from './translationErrorMessage';

describe('describeTranslationFailure', () => {
  it('does not expose low-level model output errors', () => {
    const result = describeTranslationFailure('LLM did not return a JSON object');

    expect(result).toContain('模型已响应');
    expect(result).toContain('译文格式');
    expect(result).not.toContain('JSON');
  });

  it.each([
    ['LLM_TRANSLATION_OUTPUT_LIMIT', '最大输出长度'],
    ['LLM_TRANSLATION_REASONING_ONLY', '思考过程'],
    ['LLM_TRANSLATION_CONTENT_FILTERED', '拦截'],
    ['LLM_TRANSLATION_PROVIDER_ERROR', '调用权限'],
    ['LLM_TRANSLATION_INVALID_FORMAT', '译文格式'],
    ['error sending request for url (https://private.example/?key=sk-secret)', '检查网络']
  ])('explains %s without exposing response content or credentials', (error, guidance) => {
    const result = describeTranslationFailure(`${error}: private response sk-secret`);
    expect(result).toContain(guidance);
    expect(result).not.toMatch(/sk-secret|private|LLM_TRANSLATION/);
  });

  it('maps common actionable failures to user-facing guidance', () => {
    expect(describeTranslationFailure('401 unauthorized')).toContain('API Key');
    expect(describeTranslationFailure('request timed out')).toContain('响应超时');
    expect(describeTranslationFailure('network connection failed')).toContain('检查网络');
    expect(describeTranslationFailure('请先在模型设置里配置翻译模型。')).toContain('设置中配置任务模型');
  });

  it('explains HTTP-level failures and keeps the original detail', () => {
    const notFound = describeTranslationFailure(
      'LLM request failed (404 Not Found): {"error":"no route"}'
    );
    expect(notFound).toContain('404');
    expect(notFound).toContain('Base URL');
    expect(notFound).toContain('no route');

    const badRequest = describeTranslationFailure(
      'LLM request failed (400 Bad Request): max_tokens is not supported'
    );
    expect(badRequest).toContain('400');
    expect(badRequest).toContain('max_tokens');
  });

  it('hints at empty responses without leaking protocol internals', () => {
    const result = describeTranslationFailure(
      'LLM response did not contain message content (protocol OpenaiCompatible).'
    );
    expect(result).toContain('空内容');
    expect(result).not.toContain('OpenaiCompatible');
  });
});
