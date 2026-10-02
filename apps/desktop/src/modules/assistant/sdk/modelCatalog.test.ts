import { describe, expect, it } from 'vitest';
import { combineCatalogs, enrichModelFacts, findModelMetadata, modelMetadataIndex, parseModelsDev, parseOpenRouter, positiveLimit } from './modelCatalog';

const dev = {
  example: { name: 'Example', api: 'https://models.example/v1', models: {
    chat: { id: 'chat', name: 'Chat', limit: { context: 128000, input: 100000, output: 8192 },
      tool_call: true, reasoning: false, temperature: false, modalities: { input: ['text', 'image'], output: ['text'] }, release_date: '2026-01-01' },
    unknown: { id: 'unknown', limit: { context: -1, output: '1000' } }
  } },
  other: { name: 'Other', api: 'https://other.example', models: { chat: { limit: { context: 32000, output: 1024 } } } }
};
describe('public model specifications', () => {
  it('keeps input/context/output distinct and preserves explicit false capabilities', () => {
    expect(parseModelsDev(dev)[0]).toMatchObject({ id: 'chat', providerName: 'Example', maxContextLength: 128000, maxInputTokens: 100000,
      maxOutputTokens: 8192, supportsTools: true, supportsReasoning: false, supportsTemperature: false, inputModalities: ['text', 'image'], metadataSource: 'models_dev' });
  });
  it('does not invent missing or malformed limits', () => {
    const unknown = parseModelsDev(dev)[1];
    expect(unknown.maxContextLength).toBeUndefined(); expect(unknown.maxOutputTokens).toBeUndefined(); expect(unknown.supportsTools).toBeUndefined();
    for (const value of [0, -1, Infinity, NaN, '32000', 1.2, 100_000_001]) expect(positiveLimit(value)).toBeUndefined();
    expect(parseModelsDev(null)).toEqual([]); expect(parseOpenRouter({ data: [null, {}] })).toEqual([]);
  });
  it('matches exact endpoint and model ID, never a proxy, spoofed host or similarly named version', () => {
    const rows = parseModelsDev(dev);
    expect(findModelMetadata(rows, 'https://models.example/v1/', 'chat')?.maxContextLength).toBe(128000);
    expect(findModelMetadata(rows, 'https://other.example/v1', 'chat')?.maxContextLength).toBe(32000);
    for (const url of ['https://proxy.example', 'https://models.example.attacker.test/v1', 'https://attacker.test/?url=https://models.example/v1', 'https://models.example/another/v1']) {
      expect(findModelMetadata(rows, url, 'chat')).toBeUndefined();
    }
    expect(findModelMetadata(rows, 'https://models.example', 'chat-latest')).toBeUndefined();
  });
  it('refuses ambiguous providers sharing a gateway and identical model IDs', () => {
    const rows = parseModelsDev(dev);
    rows[2].providerApi = rows[0].providerApi;
    expect(modelMetadataIndex(rows, 'https://models.example').has('chat')).toBe(false);
  });
  it('prioritizes actual provider limits per field, but refreshes previously catalog-enriched fields', () => {
    const rows = parseModelsDev(dev);
    const actual = enrichModelFacts({ id: 'chat', metadataSource: 'provider' as const, maxContextLength: 16000, maxInputTokens: 12000 }, 'https://models.example', rows);
    expect(actual).toMatchObject({ maxContextLength: 16000, maxInputTokens: 12000, contextSource: 'provider', maxOutputTokens: 8192, outputSource: 'models_dev' });
    rows[0].maxOutputTokens = 4096;
    expect(enrichModelFacts(actual, 'https://models.example', rows)).toMatchObject({ maxContextLength: 16000, maxOutputTokens: 4096, outputSource: 'models_dev' });
    expect(enrichModelFacts({ id: 'chat', maxContextLength: 999 }, 'https://models.example', rows).maxContextLength).toBe(128000);
  });
  it('uses OpenRouter serving limits and merges without discarding known models.dev fields', () => {
    const routers = parseOpenRouter({ data: [{ id: 'a/chat', context_length: 200000, top_provider: { context_length: 64000, max_completion_tokens: 4096 },
      supported_parameters: ['tools', 'temperature'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } }] });
    expect(routers[0]).toMatchObject({ maxContextLength: 64000, modelContextLength: 200000, supportsTemperature: true, supportsReasoning: false });
    const baseline = { ...parseModelsDev(dev)[0], id: 'a/chat', providerId: 'openrouter', knowledge: '2025-01' };
    const combined = combineCatalogs([baseline], routers);
    expect(combined).toHaveLength(1); expect(combined[0]).toMatchObject({ maxContextLength: 64000, knowledge: '2025-01', metadataSource: 'openrouter' });
  });
});
