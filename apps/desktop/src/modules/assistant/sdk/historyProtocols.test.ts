import { describe, expect, it } from 'vitest';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, jsonSchema, tool } from 'ai';
import type { AssistantModelTranscript } from '@/shared/types/modelTranscript';
import { replayModelTranscript } from '../runtime/modelTranscript';

const responses = {
  openai: { id: 'chat-test', object: 'chat.completion', created: 0, model: 'model',
    choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 } },
  anthropic: { id: 'msg-test', type: 'message', role: 'assistant', model: 'model',
    content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 1 } },
  google: { candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 1, totalTokenCount: 21 } }
};
describe('history through actual provider request converters', () => {
  it.each(['openai', 'anthropic', 'google'] as const)('sends paired historical tool messages through %s without enabling that tool', async protocol => {
    let body: Record<string, unknown> = {};
    const fetch = async (_input: unknown, init?: RequestInit) => {
      body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify(responses[protocol]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const options = { apiKey: 'synthetic', baseURL: 'https://example.invalid/v1', fetch: fetch as typeof globalThis.fetch };
    const model = protocol === 'openai' ? createOpenAICompatible({ name: 'test', ...options })('model')
      : protocol === 'anthropic' ? createAnthropic(options)('model') : createGoogleGenerativeAI(options)('model');
    const transcript: AssistantModelTranscript = {
      version: 1, runId: 'run', capturedAt: '', profileId: 'profile', model: 'model', protocol, sources: [], messages: [
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'read', toolName: 'read_note', input: { note_id: 'note' } }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'read', toolName: 'read_note',
          output: { type: 'json', value: { markdown: 'FULL_HISTORY_SENTINEL', revision: 'revision-1' } } }] },
        { role: 'assistant', content: 'Read the note.' }
      ]
    };
    const result = await generateText({
      model, maxRetries: 0, maxOutputTokens: 100, system: 'Use historical observations as snapshots.',
      messages: [{ role: 'user', content: 'Read note' }, ...replayModelTranscript(transcript, 'historical'), { role: 'user', content: 'What did it say?' }],
      tools: { current_tool: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }) }) }
    });
    expect(result.text).toBe('OK');
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('FULL_HISTORY_SENTINEL');
    expect(serialized).toContain('read_note');
    expect(JSON.stringify(body.tools)).not.toContain('read_note');
    if (protocol === 'openai') expect(serialized).toContain('"tool_call_id":"historical_0"');
    if (protocol === 'anthropic') expect(serialized).toContain('"tool_use_id":"historical_0"');
    if (protocol === 'google') expect(serialized).toContain('"functionResponse"');
  });
});
