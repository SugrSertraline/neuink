import { z } from 'zod';
import { AgentStoppedError, type RunBudget } from '../agent-core';

import type {
  AssistantConversationMemory,
  ConversationMessage,
  LlmProfile
} from '@/shared/ipc/assistantApi';

import { runJsonModelTask } from '../sdk/modelTasks';

const memorySchema = z.object({
  decisions: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  lastUserGoal: z.string().nullable().default(null),
  openItems: z.array(z.string()).default([]),
  summary: z.string(),
  userPreferences: z.array(z.string()).default([])
});

export function appendConversationMemory(
  harnessBrief: string,
  history: ConversationMessage[]
) {
  const memory = formatConversationMemory(latestConversationMemory(history));
  return memory ? `${harnessBrief}\n\nConversation Memory Checkpoint:\n${memory}` : harnessBrief;
}

export function latestConversationMemory(history: ConversationMessage[]) {
  for (const message of [...history].reverse()) {
    const part = [...(message.parts ?? [])].reverse()
      .find((candidate) => candidate.type === 'memory');
    if (part?.type === 'memory') return part.memory;
  }
  return null;
}

/** Keep small conversations in their original form. Summarize before the 16k
 * transcript tail would drop older turns; never pay for a checkpoint per greeting. */
export function shouldUpdateConversationMemory(history: ConversationMessage[], question: string, answer: string) {
  let checkpointIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].parts?.some(part => part.type === 'memory')) { checkpointIndex = index; break; }
  }
  const unsummarized = history.slice(checkpointIndex + 1);
  const chars = unsummarized.reduce((total, message) => total + message.content.length + 16, question.length + answer.length);
  return chars >= 8_000;
}

export function buildConversationTail(
  history: ConversationMessage[],
  maxChars = 16_000
) {
  const selected: string[] = [];
  let used = 0;
  for (const message of [...history].reverse()) {
    const content = message.content.trim();
    if (!content) continue;
    const role = message.role === 'user' ? 'User' : 'Assistant';
    const remaining = maxChars - used;
    if (remaining <= role.length + 4) break;
    const bounded = content.slice(0, Math.min(content.length, remaining - role.length - 2));
    selected.push(`${role}: ${bounded}`);
    used += role.length + bounded.length + 2;
    if (used >= maxChars) break;
  }
  return selected.reverse().join('\n\n');
}

export async function updateConversationMemory({
  budget,
  abortSignal,
  answer,
  history,
  pendingProposalCount,
  question,
  settings,
  sourceCount,
  systemPrompt
}: {
  budget?: RunBudget;
  abortSignal?: AbortSignal;
  answer: string;
  history: ConversationMessage[];
  pendingProposalCount: number;
  question: string;
  settings: LlmProfile;
  sourceCount: number;
  systemPrompt: string;
}): Promise<AssistantConversationMemory> {
  const previous = latestConversationMemory(history);
  const prompt = [
      'Update the checkpoint from the supplied conversation data.',
      'Keep only facts supported by the transcript. Resolve follow-up references when the transcript supports them.',
      'Open items are unfinished user requests or decisions still needed, not generic suggestions.',
      'User preferences must be stable interaction preferences, not one-off task instructions.',
      `Previous checkpoint:\n${previous ? JSON.stringify(previous) : 'none'}`,
      `Recent durable conversation tail:\n${buildConversationTail(history, 12_000) || 'none'}`,
      `Newest user request:\n${question}`,
      `Newest assistant outcome:\n${answer.slice(0, 8_000) || '(no textual answer)'}`,
      'Return one JSON object with: summary, lastUserGoal, decisions, openItems, entities, and userPreferences.'
    ].join('\n\n');
  const checkpoint = await generateMemoryCheckpoint({ prompt, settings, systemPrompt, abortSignal, budget });
  const materialMessageCount = history.filter((message) => !message.message_id.startsWith('client-')).length;
  return {
    decisions: uniqueText(checkpoint.decisions, 12),
    entities: uniqueText(checkpoint.entities, 16),
    last_user_goal: checkpoint.lastUserGoal?.slice(0, 500) ?? null,
    message_count: materialMessageCount + 2,
    open_items: uniqueText(checkpoint.openItems, 12),
    pending_proposal_count: pendingProposalCount,
    source_count: sourceCount,
    summary: checkpoint.summary.slice(0, 2_400),
    updated_at: new Date().toISOString(),
    user_preferences: uniqueText(checkpoint.userPreferences, 12)
  };
}

async function generateMemoryCheckpoint({
  budget,
  abortSignal,
  prompt,
  settings,
  systemPrompt
}: {
  budget?: RunBudget;
  abortSignal?: AbortSignal;
  prompt: string;
  settings: LlmProfile;
  systemPrompt: string;
}) {
  let feedback = '';
  let lastError = 'unknown validation error';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const outputValue = await runJsonModelTask({
        budget,
        abortSignal,
        settings,
        name: 'conversation_memory_checkpoint',
        description: 'A compact, factual semantic checkpoint for the next agent turn.',
        system: systemPrompt,
        prompt: feedback
          ? `${prompt}\n\nThe previous checkpoint was invalid: ${feedback}\nReturn corrected JSON only.`
          : prompt
      });
      const parsed = memorySchema.safeParse(outputValue);
      if (!parsed.success) {
        throw new Error(parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'checkpoint'}: ${issue.message}`)
          .join('; '));
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AgentStoppedError) throw error;
      abortSignal?.throwIfAborted();
      lastError = error instanceof Error ? error.message : String(error);
      feedback = lastError.slice(0, 1_000);
    }
  }
  throw new Error(`Memory task could not produce a valid checkpoint: ${lastError}`);
}

export function formatConversationMemory(memory: AssistantConversationMemory | null) {
  if (!memory) return '';
  const decisions = memory.decisions ?? [];
  const entities = memory.entities ?? [];
  const openItems = memory.open_items ?? [];
  const userPreferences = memory.user_preferences ?? [];
  return [
    `Summary: ${memory.summary}`,
    memory.last_user_goal ? `Last user goal: ${memory.last_user_goal}` : null,
    decisions.length > 0 ? `Decisions: ${decisions.join('; ')}` : null,
    openItems.length > 0 ? `Open items: ${openItems.join('; ')}` : null,
    entities.length > 0 ? `Entities: ${entities.join('; ')}` : null,
    userPreferences.length > 0
      ? `Stable user preferences: ${userPreferences.join('; ')}`
      : null,
    `Cited sources so far: ${memory.source_count}`,
    `Pending proposals: ${memory.pending_proposal_count}`
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function uniqueText(values: string[], limit: number) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .slice(0, limit)
    .map((value) => value.slice(0, 500));
}
