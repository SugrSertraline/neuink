// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmProfile } from '@/shared/ipc/assistantApi';

const { http } = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: http }));
import { generateFoldBatch } from './foldGeneration';

const profile: LlmProfile = {
  id: 'synthetic', name: 'test', base_url: 'https://example.invalid/v1', model: 'step-3.7-flash', api_key: null,
  api_protocol: 'openai_compatible', max_context_length: 300_000, max_output_tokens: null, temperature: 0.3, top_p: 0.9
};
const batch = [{ segmentUid: 'synthetic', pageIndex: 0, source: 'Waiting time decreased.', sentences: ['Waiting time decreased.'] }];

beforeEach(() => {
  http.mockReset();
  http.mockImplementation(async () => new Response(JSON.stringify({
    id: 'test-response', object: 'chat.completion', created: 1, model: profile.model,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ units: [
      { id: 'U0', role: 'result', takeaway: 'Waiting time decreased.', topic: 'Waiting time', reason: '', evidence: [0] }
    ] }) } }], usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
});

describe('folding request through the shared model adapter', () => {
  it('lets the service choose output length when the system setting is empty', async () => {
    const output = await generateFoldBatch({ batch, profile });
    expect(output.results).toHaveLength(1);
    const request = JSON.parse(http.mock.calls[0][1].body);
    expect(request).not.toHaveProperty('max_tokens');
    expect(request).not.toHaveProperty('max_completion_tokens');
    expect(request).toMatchObject({ model: profile.model, temperature: 0.3, top_p: 0.9, response_format: { type: 'json_object' } });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('sends the configured output limit instead of treating the context window as output', async () => {
    await generateFoldBatch({ batch, profile: { ...profile, max_output_tokens: 16_384 } });
    expect(JSON.parse(http.mock.calls[0][1].body).max_tokens).toBe(16_384);
  });

  it('reserves input space when the configured output ceiling equals the context window', async () => {
    const configured = { ...profile, max_context_length: 8_192, max_output_tokens: 8_192 };
    await generateFoldBatch({ batch, profile: configured });
    const request = JSON.parse(http.mock.calls[0][1].body);
    expect(request.max_tokens).toBeGreaterThan(0);
    expect(request.max_tokens).toBeLessThan(8_192 - 512);
    expect(configured.max_output_tokens).toBe(8_192);
  });

  it('rejects oversized CJK input before sending an HTTP request', async () => {
    const text = '段'.repeat(2_000);
    await expect(generateFoldBatch({ batch: [{ ...batch[0], source: text, sentences: [text] }],
      profile: { ...profile, max_context_length: 4_096 } })).rejects.toMatchObject({ name: 'ModelContextLimitError' });
    expect(http).not.toHaveBeenCalled();
  });
});
