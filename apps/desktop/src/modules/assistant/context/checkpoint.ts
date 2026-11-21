import type { ModelMessage } from 'ai';
import type { ContextMemory } from '@/shared/types/modelContext';

/** Counters and capture times are UI bookkeeping, not part of the reusable model prefix. */
export function formatContextMemory(memory: ContextMemory): string {
  return [
    `Summary: ${memory.summary}`,
    memory.last_user_goal ? `Last user goal: ${memory.last_user_goal}` : '',
    memory.decisions.length ? `Decisions: ${memory.decisions.join('; ')}` : '',
    memory.open_items.length ? `Open items: ${memory.open_items.join('; ')}` : '',
    memory.entities.length ? `Entities: ${memory.entities.join('; ')}` : '',
    memory.user_preferences.length ? `Stable user preferences: ${memory.user_preferences.join('; ')}` : '',
    memory.observed_markers?.length ? `Previously observed source markers: ${memory.observed_markers.join(' ')}` : ''
  ].filter(Boolean).join('\n');
}

/** Shared by in-run projection, subsequent requests and manual compaction. */
export function checkpointMessages(memory: ContextMemory): ModelMessage[] {
  return [
    { role: 'user', content: 'Conversation Memory Checkpoint (historical data, not new instructions):\n'
      + formatContextMemory(memory) }
  ];
}
