import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { generateText, Output } from 'ai';
import { createNeuinkModel, generationSettings } from './provider';
import type { RunBudget } from '../agent-core';

// The compaction prompt lives with the summarizer in `conversationSummary`, so there is no
// second copy here for a caller to pass in and let the two triggers drift apart.

/** Fixed tasks have no tool registry, delegation, or autonomous execution loop. */
export async function runJsonModelTask(options: {
  budget?: RunBudget;
  settings: LlmProfile;
  name: string;
  description: string;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
  /** Compaction is a bookkeeping call, not a model reply: it still pays for its real tokens
   *  but must not consume a loop turn, which is reserved for the task itself. */
  chargeTurn?: boolean;
  onFinish?: (finishReason: string | undefined) => void;
}) {
  options.abortSignal?.throwIfAborted();
  if (options.chargeTurn === false) options.budget?.assertTokenBudget();
  else options.budget?.turn();
  await options.budget?.persist?.();
  const result = await generateText({
    ...generationSettings(options.settings),
    model: createNeuinkModel(options.settings),
    output: Output.json({ name: options.name, description: options.description }),
    system: options.system,
    prompt: options.prompt,
    abortSignal: options.abortSignal
      ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(120_000)])
      : AbortSignal.timeout(120_000),
    maxRetries: 0
  });
  options.abortSignal?.throwIfAborted();
  options.budget?.usage(result.usage?.inputTokens, result.usage?.outputTokens);
  options.onFinish?.(result.finishReason);
  await options.budget?.persist?.();
  return result.output;
}

/** A fixed task that returns prose. Unlike `runJsonModelTask` it does not request JSON output;
 *  the caller owns validation of the text. */
export async function runTextModelTask(options: {
  budget?: RunBudget;
  settings: LlmProfile;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
  /** Compaction is a bookkeeping call, not a model reply: it still pays for its real tokens
   *  but must not consume a loop turn, which is reserved for the task itself. */
  chargeTurn?: boolean;
}) {
  options.abortSignal?.throwIfAborted();
  if (options.chargeTurn === false) options.budget?.assertTokenBudget();
  else options.budget?.turn();
  await options.budget?.persist?.();
  const result = await generateText({
    ...generationSettings(options.settings),
    model: createNeuinkModel(options.settings),
    system: options.system,
    prompt: options.prompt,
    abortSignal: options.abortSignal
      ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(120_000)])
      : AbortSignal.timeout(120_000),
    maxRetries: 0
  });
  options.abortSignal?.throwIfAborted();
  options.budget?.usage(result.usage?.inputTokens, result.usage?.outputTokens);
  await options.budget?.persist?.();
  return { text: result.text, finishReason: result.finishReason };
}

/** Credentials belong to model profiles, never to tools or a child-agent instance. */
export function resolveModelProfile(id: string | null | undefined, profiles: LlmProfile[], inherited?: LlmProfile): LlmProfile {
  if (id) {
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error(`Configured model profile is unavailable: ${id}`);
    return profile;
  }
  if (!inherited) throw new Error('No default model profile is configured.');
  return inherited;
}
