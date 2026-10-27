import { describe, expect, it } from 'vitest';
import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { evaluationProfile, evaluationRepeats } from './liveSettings';
import { evalError } from './diagnostics';

describe('live evaluation configuration', () => {
  const profile = { max_output_tokens: 8192, temperature: 0.4, top_p: 0.9 } as LlmProfile;
  it('preserves application settings and applies only an explicit output override', () => {
    expect(evaluationProfile(profile, {})).toEqual(profile);
    expect(evaluationProfile(profile, { NEUINK_EVAL_MAX_OUTPUT_TOKENS: '4096' })).toEqual({
      ...profile, max_output_tokens: 4096
    });
    expect(profile.max_output_tokens).toBe(8192);
  });
  it.each(['0', '-1', '1.5', 'NaN', ''])('rejects invalid output budgets: %s', value => {
    expect(() => evaluationProfile(profile, { NEUINK_EVAL_MAX_OUTPUT_TOKENS: value })).toThrow();
  });
  it('validates repetitions rather than silently skipping the evaluation', () => {
    expect(evaluationRepeats({})).toBe(1);
    expect(evaluationRepeats({ NEUINK_EVAL_REPEATS: '3' })).toBe(3);
    expect(() => evaluationRepeats({ NEUINK_EVAL_REPEATS: '0' })).toThrow();
    expect(() => evaluationRepeats({ NEUINK_EVAL_REPEATS: '21' })).toThrow();
  });
  it('never persists a raw provider exception containing request credentials', () => {
    expect(evalError(new Error('fetch failed: Authorization Bearer secret-api-key'))).not.toContain('secret-api-key');
  });
});
