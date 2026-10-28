import { generateText } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LlmProfile } from '@/shared/ipc/assistantApi';

import { createNeuinkModel } from '../../assistant/sdk/provider';
import { translationModelSettings } from './translationModelSettings';

const http = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: http }));
const profile = (model = 'glm-4.7'): LlmProfile => ({
  id: 'test', name: 'test', model, base_url: 'https://open.bigmodel.cn/api/paas/v4',
  api_key: null, api_protocol: 'openai_compatible', max_context_length: null,
  max_output_tokens: 1024, temperature: null, top_p: null
});

beforeEach(() => {
  http.mockReset();
  http.mockImplementation(async () => new Response(JSON.stringify({
    id: 'test', created: 1, model: 'glm',
    choices: [{ index: 0, message: { role: 'assistant', content: '译文' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  }), { headers: { 'content-type': 'application/json' } }));
});

describe('model-independent translation requests', () => {
  it.each([
    ['glm-4.7', 'https://open.bigmodel.cn/api/paas/v4'],
    ['glm-5.3', 'https://api.z.ai/v1'],
    ['step-3.7-flash', 'https://api.stepfun.com/v1'],
    ['unknown-future-model', 'https://custom.example/v1']
  ])('uses the same explicit parameters for %s', async (model, base_url) => {
    const config = { ...profile(model), base_url };
    await generateText({ model: createNeuinkModel(config), ...translationModelSettings(config), prompt: 'Return JSON.' });
    const body = JSON.parse(http.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1024);
    for (const field of ['thinking', 'reasoning_effort', 'response_format', 'temperature', 'top_p']) expect(body[field]).toBeUndefined();
  });
  it('retains explicit user parameters and only supplies the required Anthropic output default', () => {
    expect(translationModelSettings({ ...profile(), max_output_tokens: null })).toEqual({ maxOutputTokens: undefined, temperature: undefined, topP: undefined });
    expect(translationModelSettings({ ...profile(), temperature: 0.7, top_p: 0.8 })).toEqual({ maxOutputTokens: 1024, temperature: 0.7, topP: 0.8 });
    expect(translationModelSettings({ ...profile(), api_protocol: 'anthropic', max_output_tokens: null }).maxOutputTokens).toBe(4096);
    expect(translationModelSettings({ ...profile(), api_protocol: 'google', max_output_tokens: null }).maxOutputTokens).toBeUndefined();
  });
});
