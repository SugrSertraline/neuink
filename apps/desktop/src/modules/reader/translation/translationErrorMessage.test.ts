import { describe, expect, it } from 'vitest';

import { describeTranslationFailure } from './translationErrorMessage';

describe('describeTranslationFailure', () => {
  it('does not expose low-level model output errors', () => {
    const result = describeTranslationFailure('LLM did not return a JSON object');

    expect(result).toContain('检查任务模型配置');
    expect(result).not.toContain('JSON');
  });

  it('maps common actionable failures to user-facing guidance', () => {
    expect(describeTranslationFailure('401 unauthorized')).toContain('API Key');
    expect(describeTranslationFailure('request timed out')).toContain('响应超时');
    expect(describeTranslationFailure('network connection failed')).toContain('检查网络');
    expect(describeTranslationFailure('请先在模型设置里配置翻译模型。')).toContain('设置中配置任务模型');
  });
});
