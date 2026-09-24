import type { LlmProfile } from '@/shared/ipc/assistantApi';
import { generateText, Output } from 'ai';
import { createNeuinkModel, generationSettings } from './provider';
import type { RunBudget } from '../agent-core';

export const MEMORY_PROMPT = 'Update a factual semantic checkpoint from the prior checkpoint and conversation. Preserve goals, decisions, unresolved work, referenced entities, and stable preferences. Do not invent facts.';

/** Fixed tasks have no tool registry, delegation, or autonomous execution loop. */
export async function runJsonModelTask(options: {
  budget?: RunBudget;
  settings: LlmProfile;
  name: string;
  description: string;
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
}) {
  options.abortSignal?.throwIfAborted();
  options.budget?.turn();
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
  await options.budget?.persist?.();
  return result.output;
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
