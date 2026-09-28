/** Public specifications are suggestions, never credentials, permissions or proof of endpoint availability. */
export type ModelMetadataSource = 'built_in' | 'provider' | 'models_dev' | 'openrouter';
export type ModelFacts = {
  id: string; label?: string;
  providerId?: string; providerName?: string;
  maxContextLength?: number; maxInputTokens?: number; maxOutputTokens?: number;
  metadataSource?: ModelMetadataSource; contextSource?: ModelMetadataSource; outputSource?: ModelMetadataSource;
  modelContextLength?: number; providerContextLength?: number;
  supportsTools?: boolean; supportsReasoning?: boolean; supportsTemperature?: boolean;
  inputModalities?: string[]; outputModalities?: string[]; status?: string;
  releaseDate?: string; knowledge?: string;
};
export type CatalogModel = ModelFacts & { providerId: string; providerName: string; providerApi?: string; providerNpm?: string };
export type PublicModelCatalog = { version: 1; updatedAt: string; models: CatalogModel[]; warnings: string[] };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown, max = 300): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
export const positiveLimit = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000 ? value : undefined;
const boolean = (value: unknown) => typeof value === 'boolean' ? value : undefined;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 12).map(v => v.slice(0, 30)) : undefined;

export function endpointIdentity(value: string): string | null {
  try { const url = new URL(value); return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')}`; } catch { return null; }
}
const KNOWN_ENDPOINTS: Record<string, string> = {
  'https://api.anthropic.com': 'anthropic',
  'https://api.openai.com': 'openai',
  'https://generativelanguage.googleapis.com/v1beta': 'google',
  'https://api.moonshot.cn': 'moonshotai-cn', 'https://api.moonshot.ai': 'moonshotai',
  'https://open.bigmodel.cn/api/paas/v4': 'zhipuai',
  'https://api.z.ai/api/paas/v4': 'zai',
};
export function providersForEndpoint(models: CatalogModel[], baseUrl: string): string[] {
  const identity = endpointIdentity(baseUrl);
  if (!identity) return [];
  const exact = [...new Set(models.filter(m => m.providerApi && endpointIdentity(m.providerApi) === identity).map(m => m.providerId))];
  return exact.length ? exact : KNOWN_ENDPOINTS[identity] ? [KNOWN_ENDPOINTS[identity]] : [];
}

export function parseModelsDev(value: unknown): CatalogModel[] {
  const result: CatalogModel[] = [];
  for (const [providerId, raw] of Object.entries(object(value)).slice(0, 500)) {
    if (providerId.length > 100) continue;
    const provider = object(raw);
    for (const [key, item] of Object.entries(object(provider.models)).slice(0, 4000)) {
      const model = object(item), limits = object(model.limit), modalities = object(model.modalities);
      const id = string(model.id ?? key);
      if (!id || String(model.id ?? key).length > 300 || result.length >= 25_000) continue;
      result.push({ id, label: string(model.name), providerId: providerId.slice(0,100), providerName: string(provider.name) ?? providerId,
        providerApi: string(provider.api, 500), providerNpm: string(provider.npm, 100), metadataSource: 'models_dev', contextSource: 'models_dev', outputSource: 'models_dev',
        maxContextLength: positiveLimit(limits.context), maxInputTokens: positiveLimit(limits.input), maxOutputTokens: positiveLimit(limits.output),
        supportsTools: boolean(model.tool_call), supportsReasoning: boolean(model.reasoning), supportsTemperature: boolean(model.temperature),
        inputModalities: strings(modalities.input), outputModalities: strings(modalities.output), status: string(model.status,40),
        releaseDate: string(model.release_date,30), knowledge: string(model.knowledge,30) });
    }
  }
  return result;
}

export function parseOpenRouter(value: unknown): CatalogModel[] {
  const rows = object(value).data;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 5000).flatMap(raw => {
    const m = object(raw), route = object(m.top_provider), arch = object(m.architecture), id = string(m.id);
    if (!id) return [];
    const modelContextLength = positiveLimit(m.context_length), providerContextLength = positiveLimit(route.context_length);
    return [{ id, label: string(m.name), providerId: 'openrouter', providerName: 'OpenRouter', providerApi: 'https://openrouter.ai/api/v1',
      metadataSource: 'openrouter' as const, contextSource: 'openrouter' as const, outputSource: 'openrouter' as const,
      maxContextLength: providerContextLength ?? modelContextLength, modelContextLength, providerContextLength,
      maxOutputTokens: positiveLimit(route.max_completion_tokens), inputModalities: strings(arch.input_modalities), outputModalities: strings(arch.output_modalities),
      supportsTools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : undefined,
      supportsTemperature: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('temperature') : undefined,
      supportsReasoning: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('reasoning') : undefined }];
  });
}

export function combineCatalogs(dev: CatalogModel[], router: CatalogModel[]): CatalogModel[] {
  const models = new Map(dev.map(m => [`${m.providerId}\n${m.id}`, m]));
  for (const m of router) {
    const key = `${m.providerId}\n${m.id}`, previous = models.get(key);
    models.set(key, { ...previous, ...Object.fromEntries(Object.entries(m).filter(([,v]) => v !== undefined)) } as CatalogModel);
  }
  return [...models.values()];
}

/** Exact endpoint + exact ID only. No stripping dates/quantization or fuzzy name guesses. */
export function findModelMetadata(models: CatalogModel[], baseUrl: string, id: string): CatalogModel | undefined {
  return modelMetadataIndex(models, baseUrl).get(id.trim());
}

/** Build once per endpoint/catalog, not once for every row of a large provider list. */
export function modelMetadataIndex(models: CatalogModel[], baseUrl: string): Map<string, CatalogModel> {
  const providers = new Set(providersForEndpoint(models, baseUrl));
  const index = new Map<string, CatalogModel>();
  const ambiguous = new Set<string>();
  for (const model of models) {
    if (!providers.has(model.providerId) || ambiguous.has(model.id)) continue;
    const previous = index.get(model.id);
    if (previous && previous.providerId !== model.providerId) {
      ambiguous.add(model.id); index.delete(model.id);
    } else index.set(model.id, model);
  }
  return index;
}

export function enrichModelFacts<T extends ModelFacts>(model: T, baseUrl: string, catalog: CatalogModel[]): T {
  const found = findModelMetadata(catalog, baseUrl, model.id);
  return mergeModelMetadata(model, found);
}

export function mergeModelMetadata<T extends ModelFacts>(model: T, found?: CatalogModel): T {
  if (!found) return model;
  const provider = model.metadataSource === 'provider';
  const providerContext = model.contextSource === 'provider' || (provider && !model.contextSource);
  const providerOutput = model.outputSource === 'provider' || (provider && !model.outputSource);
  return { ...model, ...found, id: model.id,
    maxContextLength: providerContext ? model.maxContextLength ?? found.maxContextLength : found.maxContextLength,
    maxOutputTokens: providerOutput ? model.maxOutputTokens ?? found.maxOutputTokens : found.maxOutputTokens,
    maxInputTokens: provider ? model.maxInputTokens ?? found.maxInputTokens : found.maxInputTokens,
    providerContextLength: provider ? model.providerContextLength ?? found.providerContextLength : found.providerContextLength,
    modelContextLength: provider ? model.modelContextLength ?? found.modelContextLength : found.modelContextLength,
    contextSource: providerContext && model.maxContextLength != null ? 'provider' : found.contextSource,
    outputSource: providerOutput && model.maxOutputTokens != null ? 'provider' : found.outputSource,
    metadataSource: provider ? 'provider' : found.metadataSource,
  };
}

export const modelSourceLabel = (source?: ModelMetadataSource) => ({ provider: '当前服务接口', models_dev: 'models.dev', openrouter: 'OpenRouter', built_in: '内置预设' }[source ?? 'built_in']);
