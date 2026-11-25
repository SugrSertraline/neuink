import type { ProviderModelInfo } from '../assistant/sdk/provider';
import type { ModelPreset } from './components/providerPresets';

export type ModelCatalogCache = Record<
  string,
  {
    models: ModelPreset[];
    updatedAt: string;
  }
>;

const MODEL_CATALOG_CACHE_STORAGE_KEY = 'neuink.llmModelCatalog.v1';
export function readModelCatalogCache(): ModelCatalogCache {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(MODEL_CATALOG_CACHE_STORAGE_KEY) ?? '{}'
    ) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    const cache: ModelCatalogCache = {};
    for (const [key, value] of Object.entries(parsed as ModelCatalogCache)) {
      const models = Array.isArray(value.models)
        ? value.models.filter((model) => model && typeof model.id === 'string')
        : [];
      if (models.length === 0) {
        continue;
      }
      cache[normalizeBaseUrl(key)] = {
        models,
        updatedAt:
          typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString()
      };
    }
    return cache;
  } catch {
    return {};
  }
}

export function writeModelCatalogCache(cache: ModelCatalogCache) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(MODEL_CATALOG_CACHE_STORAGE_KEY, JSON.stringify(cache));
}

export function sameBaseUrl(left: string, right: string) {
  return normalizeBaseUrl(left) === normalizeBaseUrl(right);
}

export function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function mergeRemoteModelPreset(model: ProviderModelInfo, staticPresets: ModelPreset[]) {
  const fallback = staticPresets.find((preset) => preset.id === model.id);
  return {
    ...model,
    id: model.id,
    label: model.name && model.name !== model.id ? model.name : model.label,
    maxContextLength: model.maxContextLength,
    maxOutputTokens: model.maxOutputTokens,
    metadataSource: model.metadataSource ?? fallback?.metadataSource ?? 'built_in',
    modelContextLength: model.modelContextLength,
    providerContextLength: model.providerContextLength,
    temperature: fallback?.temperature ?? 0.2
  };
}

export function mergeModelPresets(primary: ModelPreset[], fallback: ModelPreset[]) {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((preset) => {
    if (seen.has(preset.id)) {
      return false;
    }
    seen.add(preset.id);
    return true;
  });
}

export function formatContextLength(value?: number) {
  if (value == null) {
    return '仅模型 ID';
  }
  if (value >= 1000000) {
    return `${Math.round(value / 10000) / 100}M ctx`;
  }
  if (value >= 1000) {
    return `${Math.round(value / 1000)}K ctx`;
  }
  return `${value} ctx`;
}

export function formatCacheTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }
  return date.toLocaleString();
}

