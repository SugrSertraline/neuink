import { z } from 'zod';
import { AgentStoppedError, type RunBudget } from '../agent-core';

import type {
  AssistantConversationMemory,
  ConversationMessage,
  LlmProfile
} from '@/shared/ipc/assistantApi';

import { jaccardSimilarity, lexicalTerms } from '../sdk/evidenceDiversity';
import { runJsonModelTask } from '../sdk/modelTasks';

const MEMORY_LISTS = {
  decisions: { limit: 12, prefix: 'd' },
  entities: { limit: 16, prefix: 'e' },
  openItems: { limit: 12, prefix: 'o' },
  userPreferences: { limit: 12, prefix: 'p' }
} as const;
type MemoryListName = keyof typeof MEMORY_LISTS;
export type MemoryLists = Record<MemoryListName, string[]>;
const memoryListNames = Object.keys(MEMORY_LISTS) as MemoryListName[];
/** An ADD this close to an existing item rewrites it instead of duplicating it. */
const MERGE_SIMILARITY = 0.8;

const memoryOperationSchema = z.object({
  event: z.enum(['ADD', 'UPDATE', 'DELETE', 'NONE']),
  id: z.string().nullish(),
  list: z.enum(['decisions', 'entities', 'openItems', 'userPreferences']),
  text: z.string().nullish()
});
export type MemoryOperation = z.infer<typeof memoryOperationSchema>;

const memorySchema = z.object({
  // Accepted for models that ignore the operation contract; merged as ADDs.
  decisions: z.array(z.string()).optional(),
  entities: z.array(z.string()).optional(),
  lastUserGoal: z.string().nullable().default(null),
  openItems: z.array(z.string()).optional(),
  operations: z.array(memoryOperationSchema).default([]),
  summary: z.string(),
  userPreferences: z.array(z.string()).optional()
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
  const previousLists = memoryListsOf(previous);
  const prompt = [
      'Update the checkpoint from the supplied conversation data.',
      'Keep only facts supported by the transcript. Resolve follow-up references when the transcript supports them.',
      'Open items are unfinished user requests or decisions still needed, not generic suggestions.',
      'User preferences must be stable interaction preferences, not one-off task instructions.',
      'Edit the remembered items with operations instead of rewriting the lists. Items you do not mention are kept unchanged.',
      'Each operation is {list, event, id, text}. list is decisions, openItems, entities, or userPreferences.',
      'ADD stores a new fact (text required, no id). UPDATE replaces an existing item (id and text required) when the transcript refines or corrects it.',
      'DELETE removes an item (id required) when it is contradicted, completed, or no longer relevant; finished open items must be deleted.',
      'Do not ADD what an existing item already says.',
      `Previous summary:\n${previous?.summary || 'none'}`,
      `Remembered items:\n${formatMemoryItems(previousLists) || 'none'}`,
      `Recent durable conversation tail:\n${buildConversationTail(history, 12_000) || 'none'}`,
      `Newest user request:\n${question}`,
      `Newest assistant outcome:\n${answer.slice(0, 8_000) || '(no textual answer)'}`,
      'Return one JSON object with: summary (the updated running summary), lastUserGoal, and operations.'
    ].join('\n\n');
  const checkpoint = await generateMemoryCheckpoint({ prompt, settings, systemPrompt, abortSignal, budget });
  const lists = applyMemoryOperations(previousLists, [
    ...checkpoint.operations,
    ...legacyListOperations(checkpoint)
  ]);
  const materialMessageCount = history.filter((message) => !message.message_id.startsWith('client-')).length;
  return {
    decisions: lists.decisions,
    entities: lists.entities,
    last_user_goal: checkpoint.lastUserGoal?.slice(0, 500) ?? null,
    message_count: materialMessageCount + 2,
    open_items: lists.openItems,
    pending_proposal_count: pendingProposalCount,
    source_count: sourceCount,
    summary: checkpoint.summary.slice(0, 2_400),
    updated_at: new Date().toISOString(),
    user_preferences: lists.userPreferences
  };
}

export function memoryListsOf(memory: AssistantConversationMemory | null): MemoryLists {
  return {
    decisions: uniqueText(memory?.decisions ?? [], MEMORY_LISTS.decisions.limit),
    entities: uniqueText(memory?.entities ?? [], MEMORY_LISTS.entities.limit),
    openItems: uniqueText(memory?.open_items ?? [], MEMORY_LISTS.openItems.limit),
    userPreferences: uniqueText(memory?.user_preferences ?? [], MEMORY_LISTS.userPreferences.limit)
  };
}

/** Stable per-turn ids (d1, o2, ...) the model uses to address existing items. */
export function formatMemoryItems(lists: MemoryLists) {
  return memoryListNames.flatMap((list) => lists[list].map((text, index) =>
    `${MEMORY_LISTS[list].prefix}${index + 1} [${list}] ${text}`)).join('\n');
}

/**
 * Mem0-style memory update (Chhikara et al., 2025): the model proposes
 * ADD/UPDATE/DELETE/NONE against addressed items and the host applies them
 * deterministically, so unmentioned memories are never silently dropped.
 */
export function applyMemoryOperations(previous: MemoryLists, operations: MemoryOperation[]): MemoryLists {
  const working = Object.fromEntries(memoryListNames.map((list) => [
    list,
    previous[list].map((text, index) => ({ id: `${MEMORY_LISTS[list].prefix}${index + 1}`, text }) as { id: string; text: string | null })
  ])) as Record<MemoryListName, { id: string; text: string | null }[]>;

  for (const operation of operations) {
    const items = working[operation.list];
    const text = operation.text?.trim().slice(0, 500) ?? '';
    const id = operation.id?.trim();
    const target = id ? items.find((item) => item.id === id && item.text !== null) : undefined;
    if (operation.event === 'DELETE') {
      if (target) target.text = null;
    } else if (operation.event === 'UPDATE' && text) {
      // An UPDATE with an unknown id still carries a fact; keep it as an ADD.
      if (target) target.text = text;
      else addMemoryItem(items, text);
    } else if (operation.event === 'ADD' && text) {
      addMemoryItem(items, text);
    }
  }

  return Object.fromEntries(memoryListNames.map((list) => {
    const texts = uniqueText(working[list].flatMap((item) => (item.text ? [item.text] : [])), Number.POSITIVE_INFINITY);
    // Evict the oldest items first so recent context survives the cap.
    return [list, texts.slice(Math.max(0, texts.length - MEMORY_LISTS[list].limit))];
  })) as MemoryLists;
}

function addMemoryItem(items: { id: string; text: string | null }[], text: string) {
  const terms = lexicalTerms(text);
  const normalized = normalizeMemoryText(text);
  const duplicate = items.find((item) => item.text !== null && (
    normalizeMemoryText(item.text) === normalized ||
    jaccardSimilarity(terms, lexicalTerms(item.text)) >= MERGE_SIMILARITY
  ));
  if (duplicate) duplicate.text = text;
  else items.push({ id: `new-${items.length + 1}`, text });
}

function normalizeMemoryText(text: string) {
  return text.toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

function legacyListOperations(checkpoint: z.infer<typeof memorySchema>): MemoryOperation[] {
  return memoryListNames.flatMap((list) => (checkpoint[list] ?? []).map((text) => ({ event: 'ADD' as const, list, text })));
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
