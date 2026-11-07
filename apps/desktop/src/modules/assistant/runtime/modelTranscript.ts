import type { ModelMessage } from 'ai';
import type { ConversationMessage, ConversationSourceLink } from '@/shared/ipc/assistantApi';
import { conversationSourceSnapshotKey } from '@/shared/ipc/assistantApi';
import type { AssistantModelTranscript } from '@/shared/types/modelTranscript';
import { canonicalAssistantToolId } from '@/shared/lib/assistantToolNames';
import { validContextUsage } from '../sdk/contextUsage';

export type TranscriptModel = { profileId: string; model: string; protocol: string };

export function citationDisplayContext(markers?: readonly number[]): ModelMessage | undefined {
  if (!markers?.some((marker, position) => marker !== position + 1)) return;
  return { role: 'user', content: 'Citation numbering for the preceding displayed answer: '
    + markers.map((marker, position) => 'UI [S' + (position + 1) + '] = stable [S' + marker + ']').join('; ')
    + '. New model answers use stable markers; the host handles display numbering.' };
}

export function latestContextUsage(history: readonly ConversationMessage[], model: TranscriptModel) {
  for (let index = history.length - 1; index >= 0; index--) {
    const saved = modelTranscript(history[index]);
    if (saved && saved.profileId === model.profileId && saved.model === model.model && saved.protocol === model.protocol
      && validContextUsage(saved.contextUsage)) return saved.contextUsage;
  }
}

export function modelTranscript(message: ConversationMessage): AssistantModelTranscript | undefined {
  const part = message.parts?.find(part => part.type === 'model-transcript');
  if (part?.type !== 'model-transcript') return;
  const value = part.transcript;
  if (!value || value.version !== 1 || typeof value.runId !== 'string'
    || typeof value.capturedAt !== 'string' || typeof value.profileId !== 'string'
    || typeof value.model !== 'string' || typeof value.protocol !== 'string'
    || (value.outcome !== undefined && !['running', 'completed', 'failed', 'cancelled'].includes(value.outcome))
    || (value.displaySourceMarkers !== undefined && (!Array.isArray(value.displaySourceMarkers)
      || value.displaySourceMarkers.some(marker => !Number.isSafeInteger(marker) || marker < 1)))
    || !Array.isArray(value.messages) || !Array.isArray(value.sources)
    || value.messages.some(message => !validMessage(message))
    || value.sources.some(pair => !Array.isArray(pair) || pair.length !== 2
      || !Number.isSafeInteger(pair[0]) || pair[0] < 1 || !validSource(pair[1]))) {
    return;
  }
  return value;
}

/** Never trust UI summaries to reconstruct tool output. Only persist model-visible messages. */
export function snapshotModelTranscript(value: AssistantModelTranscript): AssistantModelTranscript {
  return JSON.parse(JSON.stringify(value)) as AssistantModelTranscript;
}

/** Keep complete call/result batches; interrupted attempts remain in storage, not as fake results. */
export function replayModelTranscript(
  transcript: AssistantModelTranscript, namespace: string, model?: TranscriptModel
): ModelMessage[] {
  const messages = snapshotModelTranscript(transcript).messages;
  const compatible = !model || (model.profileId === transcript.profileId
    && model.model === transcript.model && model.protocol === transcript.protocol);
  const turns: ModelMessage[] = [];
  let incomplete = false;
  let sequence = 0;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === 'tool') { incomplete = true; continue; }
    if (message.role === 'user') { turns.push(message); continue; }
    if (message.role !== 'assistant') continue;
    if (typeof message.content === 'string') { if (message.content.trim()) turns.push(message); continue; }
    const calls = message.content.filter(part => part.type === 'tool-call');
    const results: Extract<ModelMessage, { role: 'tool' }>[] = [];
    while (messages[index + 1]?.role === 'tool') results.push(messages[++index] as Extract<ModelMessage, { role: 'tool' }>);
    const validIds = new Set(calls.filter(call => {
      const matching = results.flatMap(result => result.content).filter(part =>
        part.type === 'tool-result' && part.toolCallId === call.toolCallId && part.toolName === call.toolName);
      return matching.length === 1 && calls.filter(other => other.toolCallId === call.toolCallId).length === 1;
    }).map(call => call.toolCallId));
    const ids = new Map([...validIds].map(id => [id, namespace + '_' + sequence++]));
    if (calls.length !== validIds.size) incomplete = true;
    const content = message.content.filter(part =>
      (part.type !== 'tool-call' || validIds.has(part.toolCallId))
      && (compatible || part.type !== 'reasoning')).map(part =>
      part.type === 'tool-call' ? { ...part, toolCallId: ids.get(part.toolCallId)! } : part);
    if (content.some(part => part.type !== 'reasoning')) turns.push({ ...message, content });
    for (const result of results) {
      const kept = result.content.filter(part => part.type === 'tool-result' && validIds.has(part.toolCallId));
      if (kept.length !== result.content.length) incomplete = true;
      if (kept.length) turns.push({ ...result, content: kept.map(part =>
        part.type === 'tool-result' ? { ...part, toolCallId: ids.get(part.toolCallId)! } : part) });
    }
  }
  if (incomplete) turns.push({ role: 'user', content:
    'Historical execution record: some tool attempts have no complete result. Their outcome is unknown; they are not evidence of success. Do not repeat writes automatically. Inspect current state with permitted read tools when relevant.' });
  if (transcript.outcome && transcript.outcome !== 'completed') turns.push({ role: 'user', content:
    `Historical task ${transcript.outcome}. Any draft response above was not delivered as a verified successful answer. Only completed tool results establish completed operations; no pending proposal was applied by this transcript.` });
  return compatible ? turns : turns.map(message => {
    const { providerOptions: _options, ...rest } = message;
    if (typeof rest.content === 'string') return rest;
    return { ...rest, content: rest.content.map(part =>
      Object.fromEntries(Object.entries(part).filter(([key]) => key !== 'providerOptions')))
    } as ModelMessage;
  });
}

export function conversationTranscriptSources(history: readonly ConversationMessage[]) {
  const sources = new Map<number, ConversationSourceLink>();
  for (const message of history) {
    for (const [marker, source] of modelTranscript(message)?.sources ?? []) {
      const previous = sources.get(marker);
      if (previous && conversationSourceSnapshotKey(previous) !== conversationSourceSnapshotKey(source)) {
        throw new Error('会话来源编号冲突，无法安全恢复上下文。');
      }
      sources.set(marker, source);
    }
  }
  return sources;
}

/** Citation metadata only. Never feed these observations into current tool prerequisites or grants. */
export function transcriptObservations(history: readonly ConversationMessage[]) {
  const observations: Array<{ toolName: string; output: unknown }> = [];
  for (const [index, message] of history.entries()) {
    const transcript = modelTranscript(message);
    if (!transcript) continue;
    for (const turn of replayModelTranscript(transcript, 'history_' + index)) {
      if (turn.role !== 'tool') continue;
      for (const part of turn.content) {
        if (part.type !== 'tool-result' || part.output.type !== 'json') continue;
        observations.push({ toolName: canonicalAssistantToolId(part.toolName),
          output: part.output.value });
      }
    }
  }
  return observations;
}

function validSource(value: unknown): value is ConversationSourceLink {
  if (!value || typeof value !== 'object') return false;
  const source = value as Record<string, unknown>;
  return typeof source.quote === 'string' && (source.provider === 'sciverse'
    ? typeof source.doc_id === 'string' && typeof source.title === 'string'
    : typeof source.entry_id === 'string' && typeof source.segment_uid === 'string'
      && Number.isSafeInteger(source.page_idx) && (source.page_idx as number) >= 0);
}

function validMessage(value: unknown): value is ModelMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as { role?: unknown; content?: unknown };
  if (!['user', 'assistant', 'tool'].includes(message.role as string)) return false;
  if (typeof message.content === 'string') return message.role !== 'tool';
  return Array.isArray(message.content) && message.content.every(part => {
    if (!part || typeof part !== 'object') return false;
    if (part.type === 'tool-call') return message.role === 'assistant'
      && typeof part.toolCallId === 'string' && typeof part.toolName === 'string' && 'input' in part;
    if (part.type === 'tool-result') return message.role === 'tool'
      && typeof part.toolCallId === 'string' && typeof part.toolName === 'string'
      && part.output && ['json', 'text', 'error-text', 'error-json'].includes(part.output.type);
    return message.role !== 'tool' && ['text', 'reasoning'].includes(part.type) && typeof part.text === 'string';
  });
}
