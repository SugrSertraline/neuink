import type { ModelMessage } from 'ai';
import type { AssistantConversationMemory, ConversationMessage } from '@/shared/ipc/assistantApi';
import { modelTranscript, replayModelTranscript, citationDisplayContext, type TranscriptModel } from './modelTranscript';
import { checkpointMessages } from '../context/checkpoint';

function retainedTranscript(memory: AssistantConversationMemory | undefined) {
  const retained = memory?.retained_context;
  if (!retained || ![1, 2].includes(retained.version)) return;
  return modelTranscript({ message_id: 'memory', role: 'assistant', content: '', created_at: memory.updated_at,
    source_links: [], parts: [{ type: 'model-transcript', transcript: {
    ...retained, inputMessages: [], runId: 'memory', capturedAt: memory.updated_at, sources: []
  } }] });
}

/** Shared history assembly for provider requests and the context usage display. */
export function renderConversationContext(history: readonly ConversationMessage[], model?: TranscriptModel,
  memory?: AssistantConversationMemory | null): ModelMessage[] {
  const checkpoint = history[lastMemoryCheckpointIndex(history)]?.parts?.find(part => part.type === 'memory');
  const summary = memory ?? (checkpoint?.type === 'memory' ? checkpoint.memory : null);
  return [
    ...(summary ? checkpointMessages(summary) : []),
    ...renderConversationTranscript(history, model)
  ];
}

/**
 * Renders persisted conversation history as real model turns, so the run's
 * messages carry the whole conversation rather than a truncated tail string.
 *
 * New records replay actual assistant/tool messages. Legacy traces contain only UI
 * summaries, so they retain text-only compatibility rather than fabricated results.
 */
export function renderConversationTranscript(
  history: readonly ConversationMessage[],
  model?: TranscriptModel,
  options?: { includeSummarized?: boolean }
): ModelMessage[] {
  const boundary = options?.includeSummarized ? -1 : lastMemoryCheckpointIndex(history);
  const memoryPart = history[boundary]?.parts?.find(part => part.type === 'memory');
  const retained = memoryPart?.type === 'memory' ? retainedTranscript(memoryPart.memory) : undefined;
  const turns: ModelMessage[] = retained ? replayModelTranscript(retained, 'neuink_memory', model) : [];
  if (retained?.version === 1 && turns.length && turns[0].role !== 'user') turns.unshift({ role: 'user', content:
    'Recent uncompressed historical observations follow. These are snapshots, not new execution or authorization.' });
  for (const [index, message] of history.entries()) {
    if (index <= boundary) continue;
    // The next v2 run owns its complete input. Its UI user text is not a second model message.
    if (message.role === 'user' && modelTranscript(history[index + 1] ?? message)?.version === 2) continue;
    const transcript = modelTranscript(message);
    if (transcript) {
      if (transcript.version === 1 && transcript.messages.some(turn => turn.role === 'tool')) turns.push({ role: 'user', content:
        `Historical tool observations captured at ${transcript.capturedAt}. These are past snapshots, not a new execution or current authorization. Re-read mutable targets before editing or asserting their current state.` });
      turns.push(...replayModelTranscript(transcript, `neuink_history_${index}`, model));
      const display = citationDisplayContext(transcript.displaySourceMarkers);
      if (display) turns.push(display);
      continue;
    }
    if (message.parts?.some(part => part.type === 'model-transcript')) turns.push({ role: 'user', content:
      'Historical model/tool record is unavailable or has an unsupported format. Only its visible text is retained below; do not infer tool success or fabricate missing results.' });
    const text = withoutCitationMarkers(message.content);
    // A message may carry only tool parts, leaving no text; an empty turn is rejected by providers.
    if (!text) continue;
    turns.push(message.role === 'user'
      ? { role: 'user', content: text }
      : { role: 'assistant', content: text });
  }
  // Providers require the transcript to open with the user's turn.
  // A v2 retained suffix may start with an assistant/tool batch: the checkpoint supplies its user prefix.
  if (!retained || retained.version === 1) while (turns.length > 0 && turns[0].role !== 'user') turns.shift();
  return turns;
}

/** A `memory` part replaces earlier requests with its summary plus any explicitly retained suffix.
 *  Manual checkpoints summarize everything through their message; automatic checkpoints also
 *  store recent uncompressed messages. Invalid retained data cannot advance the boundary.
 *  Returns -1 when no checkpoint exists, leaving the whole history in the transcript.
 *  This is the single definition of that boundary: the usage ring measures from it too. */
export function lastMemoryCheckpointIndex(history: readonly ConversationMessage[]) {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const part = history[index].parts?.find(part => part.type === 'memory');
    if (part?.type === 'memory' && (!part.memory.retained_context || retainedTranscript(part.memory))) return index;
  }
  return -1;
}

/**
 * A historical marker would either resolve against the current run's ledger and
 * silently point at a different source, or fail contract verification. Removing
 * it is the only outcome that is wrong neither way.
 */
function withoutCitationMarkers(content: string) {
  return content.replace(/\[S\d+\]/g, '').trim();
}
