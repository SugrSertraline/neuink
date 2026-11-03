import type { AgentCheckpoint } from '../agent-core';
import type { DurableExecution } from './durableExecution';
import type { AssistantContextUsage, AssistantModelTranscript } from '@/shared/types/modelTranscript';
import type { ConversationSourceLink } from '@/shared/ipc/assistantApi';
import type { ModelMessage } from 'ai';
import { snapshotModelTranscript, type TranscriptModel } from './modelTranscript';

/** One run owns one suffix of the canonical transcript, including after an explicit resume. */
export function createTranscriptRecorder(options: {
  execution?: DurableExecution;
  model: TranscriptModel;
  initialMessageCount: number;
  sources: ReadonlyMap<number, ConversationSourceLink>;
  firstNewMarker: number;
  onTranscript?: (transcript: AssistantModelTranscript) => void | Promise<void>;
  contextUsage?: () => AssistantContextUsage | undefined;
}) {
  const { execution } = options;
  const startIndex = execution?.get<number>('transcriptStart:main') ?? options.initialMessageCount;
  if (!Number.isSafeInteger(startIndex) || startIndex < 0
    || startIndex > (execution?.actor<ModelMessage>('main')?.messages.length ?? options.initialMessageCount)) {
    throw new Error('任务检查点中的上下文起点无效，已停止恢复。');
  }
  execution?.set('transcriptStart:main', startIndex);
  const identity = execution?.get<{ runId: string; capturedAt: string }>('transcriptIdentity:main')
    ?? { runId: execution?.record.id ?? crypto.randomUUID(), capturedAt: new Date().toISOString() };
  execution?.set('transcriptIdentity:main', identity);
  let current: AssistantModelTranscript | undefined;
  return {
    startIndex,
    get current() { return current; },
    async save(checkpoint: AgentCheckpoint<ModelMessage>) {
      const sources = [...options.sources].filter(([marker]) => marker >= options.firstNewMarker);
      // Only the controller's final result save establishes verified delivery. A crash
      // between model completion and harness verification must leave this a draft.
      const outcome = 'running';
      // Pending-attempt/budget checkpoints do not change model messages. Avoid duplicate large
      // conversation writes; the execution checkpoint still records every attempt separately.
      if (current?.messages.length === checkpoint.messages.length - startIndex
        && current.sources.length === sources.length && current.outcome === outcome) return;
      current = snapshotModelTranscript({ version: 1, ...identity, ...options.model, outcome,
        messages: checkpoint.messages.slice(startIndex), sources, contextUsage: options.contextUsage?.() });
      await options.onTranscript?.(current);
    },
    async finish(displaySources: readonly ConversationSourceLink[]) {
      if (!current) return;
      const sourceMarkers = new Map([...options.sources].map(([marker, source]) => [source, marker]));
      current = { ...current, outcome: 'completed', displaySourceMarkers: displaySources.map(source => {
        const marker = sourceMarkers.get(source);
        if (marker === undefined) throw new Error('回答来源与模型消息记录不一致，无法保存。');
        return marker;
      }) };
      await options.onTranscript?.({ ...current, outcome: 'running' });
    }
  };
}
