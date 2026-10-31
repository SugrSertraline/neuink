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
  timeoutMs?: number;
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
      ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(options.timeoutMs ?? 120_000)])
      : AbortSignal.timeout(options.timeoutMs ?? 120_000),
    maxRetries: 0
  });
  options.abortSignal?.throwIfAborted();
  options.budget?.usage(result.usage?.inputTokens, result.usage?.outputTokens);
  await options.budget?.persist?.();
  if (result.finishReason === 'length') {
    throw new Error('模型输出达到长度上限，未生成完整结果。请提高该模型的最大输出 Token 后重试。');
  }
  if (result.finishReason === 'content-filter') {
    throw new Error('模型服务未返回结果：输出被内容过滤。请检查模型设置或更换模型。');
  }
  try {
    return result.output;
  } catch (error) {
    if (error instanceof Error && error.name === 'AI_NoOutputGeneratedError') {
      throw new Error('模型没有返回可用内容。请重试，或检查所选模型是否支持 JSON 输出。');
    }
    if (error instanceof Error && error.name === 'AI_NoObjectGeneratedError') {
      throw new Error('模型返回的内容不是有效 JSON。请重试，或更换支持 JSON 输出的模型。');
    }
    throw error;
  }
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
