import type { ModelMessage } from 'ai';
import type { AssistantConversationMemory, ConversationMessage } from '@/shared/ipc/assistantApi';
import { modelTranscript, replayModelTranscript, citationDisplayContext, type TranscriptModel } from './modelTranscript';
import { checkpointMessages } from '../context/checkpoint';

function retainedTranscript(memory: AssistantConversationMemory | undefined) {
  const retained = memory?.retained_context;
  if (!retained || retained.version !== 2) return;
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

/** Replay current model records only; UI text never reconstructs missing model history. */
export function renderConversationTranscript(
  history: readonly ConversationMessage[],
  model?: TranscriptModel,
  options?: { includeSummarized?: boolean }
): ModelMessage[] {
  const boundary = options?.includeSummarized ? -1 : lastMemoryCheckpointIndex(history);
  const memoryPart = history[boundary]?.parts?.find(part => part.type === 'memory');
  const retained = memoryPart?.type === 'memory' ? retainedTranscript(memoryPart.memory) : undefined;
  const turns: ModelMessage[] = retained ? replayModelTranscript(retained, model) : [];
  for (const message of history.slice(boundary + 1)) {
    const transcript = modelTranscript(message);
    if (!transcript) continue;
    turns.push(...replayModelTranscript(transcript, model));
    const display = citationDisplayContext(transcript.displaySourceMarkers);
    if (display) turns.push(display);
  }
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
