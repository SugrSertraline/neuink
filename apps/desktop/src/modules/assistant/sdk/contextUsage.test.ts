import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { estimateMessagesTokens, recentContextStart, usageCalibration, validContextUsage } from './contextUsage';

describe('model context accounting', () => {
  it('ignores provider signatures while counting full tool output data', () => {
    const plain: ModelMessage[] = [{ role: 'assistant', content: [{ type: 'reasoning', text: 'Compare.' }] }];
    const signed: ModelMessage[] = [{ role: 'assistant', content: [{ type: 'reasoning', text: 'Compare.',
      providerOptions: { anthropic: { signature: 'x'.repeat(100_000) } } }] }];
    expect(estimateMessagesTokens(signed)).toBe(estimateMessagesTokens(plain));
    const result = (value: string): ModelMessage => ({ role: 'tool', content: [{ type: 'tool-result',
      toolCallId: 'call', toolName: 'read', output: { type: 'json', value: { text: value } } }] });
    expect(estimateMessagesTokens([result('中'.repeat(10_000))]))
      .toBeGreaterThan(estimateMessagesTokens([result('中'.repeat(1_000))]) + 10_000);
  });

  it('keeps multiple parallel results with their single assistant call batch', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Old question' },
      { role: 'assistant', content: ['a', 'b'].map(toolCallId => ({ type: 'tool-call' as const,
        toolCallId, toolName: 'read', input: {} })) },
      ...['a', 'b'].map(toolCallId => ({ role: 'tool' as const, content: [{ type: 'tool-result' as const,
        toolCallId, toolName: 'read', output: { type: 'text' as const, value: 'result'.repeat(100) } }] }))
    ];
    expect(recentContextStart(messages, 1)).toBe(1);
    expect(messages[recentContextStart(messages, 1)].role).toBe('assistant');
  });

  it('rejects invalid calibration and never treats missing usage as zero occupancy', () => {
    const usage = { version: 1 as const, inputTokens: 1_000, estimatedInputTokens: 2_000,
      overheadTokens: 100, messageTokens: 1_900 };
    expect(usageCalibration(usage)).toBe(0.5);
    expect(usageCalibration(undefined)).toBe(1);
    for (const inputTokens of [0, -1, Infinity, NaN, 0.5]) {
      expect(validContextUsage({ ...usage, inputTokens })).toBe(false);
    }
  });
});
