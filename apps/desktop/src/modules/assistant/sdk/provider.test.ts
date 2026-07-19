import { describe, expect, it } from 'vitest';

import { providerModelInfoFromApiItem } from './provider';

describe('provider model metadata', () => {
  it('keeps context window and maximum output as separate values', () => {
    const metadata = providerModelInfoFromApiItem(
      {
        context_length: 1_048_576,
        id: 'deepseek/deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        top_provider: {
          context_length: 1_048_576,
          max_completion_tokens: 384_000
        }
      },
      'provider'
    );

    expect(metadata.maxContextLength).toBe(1_048_576);
    expect(metadata.maxOutputTokens).toBe(384_000);
    expect(metadata.modelContextLength).toBe(1_048_576);
  });

  it('keeps a lower OpenRouter provider limit visible without replacing model context', () => {
    const metadata = providerModelInfoFromApiItem(
      {
        context_length: 163_840,
        id: 'deepseek/deepseek-r1',
        top_provider: {
          context_length: 64_000,
          max_completion_tokens: 16_000
        }
      },
      'provider'
    );

    expect(metadata.maxContextLength).toBe(163_840);
    expect(metadata.modelContextLength).toBe(163_840);
    expect(metadata.providerContextLength).toBe(64_000);
  });
});
