import type { LlmProfile } from '@/shared/ipc/assistantApi';

export function evaluationRepeats(environment = process.env): number {
  return positiveInteger(environment.NEUINK_EVAL_REPEATS ?? '1', 'NEUINK_EVAL_REPEATS', 20);
}

/** Preserve the application's generation settings unless an experiment explicitly overrides them. */
export function evaluationProfile(profile: LlmProfile, environment = process.env): LlmProfile {
  const limit = environment.NEUINK_EVAL_MAX_OUTPUT_TOKENS;
  return { ...profile, ...(limit === undefined ? {} : {
    max_output_tokens: positiveInteger(limit, 'NEUINK_EVAL_MAX_OUTPUT_TOKENS')
  }) };
}

function positiveInteger(value: string, name: string, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return parsed;
}
