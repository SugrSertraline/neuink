import { endpointIdentity, providersForEndpoint, type CatalogModel } from '@/modules/assistant/sdk/modelCatalog';
import type { LlmApiProtocol } from '@/shared/ipc/assistantApi';
import { PROVIDER_PRESETS, type ProviderPreset } from './components/providerPresets';

export type ProviderOption = { id: string; label: string; baseUrl: string; count: number; preset?: ProviderPreset; reason?: string; builtIn: boolean };
const protocols: Record<string, LlmApiProtocol> = {
  '@ai-sdk/openai-compatible': 'openai_compatible', '@ai-sdk/openai': 'openai_compatible',
  '@ai-sdk/anthropic': 'anthropic', '@ai-sdk/google': 'google',
};
function usableEndpoint(raw: string | undefined): string | undefined {
  try {
    const url = new URL(raw ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || raw?.includes('{') || raw?.includes('$')) return;
    return url.href.replace(/\/$/, '');
  } catch { return; }
}
export function providerOptions(catalog: CatalogModel[]): ProviderOption[] {
  const groups = new Map<string, CatalogModel[]>();
  for (const model of catalog) { const rows = groups.get(model.providerId) ?? []; rows.push(model); groups.set(model.providerId, rows); }
  const builtInIds = new Set<string>();
  const builtIn = PROVIDER_PRESETS.map(preset => {
    const ids = providersForEndpoint(catalog, preset.baseUrl);
    ids.forEach(id => builtInIds.add(id));
    const count = new Set([...preset.models.map(m => m.id), ...ids.flatMap(id => (groups.get(id) ?? []).map(m => m.id))]).size;
    return { id: `builtin:${preset.label}`, label: preset.label, baseUrl: preset.baseUrl, count, preset, builtIn: true };
  });
  const endpoints = new Set(builtIn.map(row => endpointIdentity(row.baseUrl)));
  return [...builtIn, ...[...groups].flatMap(([id, models]): ProviderOption[] => {
    const first = models[0], baseUrl = usableEndpoint(first.providerApi);
    if (builtInIds.has(id) || (baseUrl && endpoints.has(endpointIdentity(baseUrl)))) return [];
    // Unknown SDKs, region placeholders and endpoints without a declared protocol need manual setup.
    const protocol = first.providerNpm ? protocols[first.providerNpm] : undefined;
    const consistent = models.every(m => m.providerApi === first.providerApi && m.providerNpm === first.providerNpm);
    const preset: ProviderPreset | undefined = baseUrl && protocol && consistent ? {
      label: first.providerName, baseUrl, protocol, models: [],
      brand: { mark: '', foreground: 'currentColor', background: 'transparent' },
    } : undefined;
    return [{ id, label: first.providerName, baseUrl: baseUrl ?? '', count: models.length, preset, builtIn: false,
      reason: preset ? undefined : !baseUrl ? '请填写接口地址，并选择接口类型。' : '请确认接口类型；若服务使用专有协议，需要填写它提供的兼容接口地址。' }];
  })];
}
