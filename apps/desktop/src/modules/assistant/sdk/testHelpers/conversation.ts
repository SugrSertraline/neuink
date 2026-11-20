import type { ConversationMessage } from '@/shared/ipc/assistantApi';
import type { TranscriptModel } from '../../runtime/modelTranscript';

/** A current-format fixture stores the submitted input and model output on the assistant turn. */
export function recordedTurn(question: string, answer: string, index: number,
  model: TranscriptModel = { profileId: 'profile', model: 'model', protocol: 'openai_compatible' }): ConversationMessage[] {
  return [
    { message_id: `user-${index}`, role: 'user', content: question, created_at: '', source_links: [], parts: [] },
    { message_id: `assistant-${index}`, role: 'assistant', content: answer, created_at: '', source_links: [],
      parts: [{ type: 'model-transcript', transcript: {
        version: 2, runId: `run-${index}`, capturedAt: '', ...model, outcome: 'completed', sources: [],
        inputMessages: [{ role: 'user', content: question }],
        messages: answer ? [{ role: 'assistant', content: answer }] : []
      } }] }
  ];
}
