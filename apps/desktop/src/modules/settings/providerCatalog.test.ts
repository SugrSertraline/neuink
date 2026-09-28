import { expect, it } from 'vitest';
import { catalogSearchScore, providerAliases } from './catalogSearch';
import { providerOptions } from './providerCatalog';
import { parseModelsDev, type CatalogModel } from '@/modules/assistant/sdk/modelCatalog';

it('matches aliases, punctuation, case and subsequences but never unrelated names', () => {
  expect(catalogSearchScore('阶跃', ['stepfun', providerAliases('stepfun')])).toBeGreaterThan(0);
  expect(catalogSearchScore('深度', ['DeepSeek', providerAliases('DeepSeek')])).toBeGreaterThan(0);
  expect(catalogSearchScore('dpsk', ['DeepSeek'])).toBeGreaterThan(0);
  expect(catalogSearchScore('GPT 4.1', ['gpt-4.1'])).toBeGreaterThan(0);
  expect(catalogSearchScore('deepseek', ['DeepSeek'])).toBeGreaterThan(catalogSearchScore('dpsk', ['DeepSeek']));
  expect(catalogSearchScore('nothing', ['DeepSeek'])).toBe(0);
});
it('retains built-ins offline and exposes compatible public providers without inferring protocol', () => {
  const catalog = parseModelsDev({ demo: { name: 'Demo', api: 'https://demo.example/v1', npm: '@ai-sdk/openai-compatible', models: { chat: { id: 'chat' } } } });
  expect(catalog[0].providerNpm).toBe('@ai-sdk/openai-compatible');
  const options = providerOptions(catalog);
  expect(providerOptions([]).length).toBeGreaterThan(5);
  expect(options.find(row => row.id === 'demo')?.preset).toMatchObject({ baseUrl: 'https://demo.example/v1', protocol: 'openai_compatible', models: [] });
  const unsafe = ['http://demo.example', 'https://user:pass@demo.example', 'https://demo.example?key=secret', 'https://${region}.example', undefined];
  for (const api of unsafe) expect(providerOptions([{ ...catalog[0], providerApi: api }]).find(row => row.id === 'demo')?.preset).toBeUndefined();
  expect(providerOptions([{ ...catalog[0], providerNpm: '@custom/unknown' }]).find(row => row.id === 'demo')?.preset).toBeUndefined();
});
it('does not duplicate built-in endpoints or confuse incompatible protocols', () => {
  const base: CatalogModel = { id: 'chat', providerId: 'demo', providerName: 'Demo', providerApi: 'https://api.deepseek.com/v1' };
  expect(providerOptions([base]).some(row => row.id === 'demo')).toBe(false);
  expect(providerOptions([{ ...base, providerApi: 'https://other.example/v1', providerNpm: '@ai-sdk/anthropic' }]).find(row => row.id === 'demo')?.preset?.protocol).toBe('anthropic');
});
