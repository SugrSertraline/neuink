import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

import type { LlmProfile } from '@/shared/ipc/assistantApi';

export type ProviderModelInfo = {
  id: string;
  maxContextLength?: number;
  maxOutputTokens?: number;
  metadataSource?: 'openrouter' | 'provider';
  modelContextLength?: number;
  name?: string;
  providerContextLength?: number;
};

export type ProviderModelApiItem = {
  context_length?: unknown;
  id?: unknown;
  name?: unknown;
  top_provider?: { context_length?: unknown; max_completion_tokens?: unknown };
};

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

export function createNeuinkModel(settings: LlmProfile) {
  const provider = createOpenAICompatible({
    name: 'neuink',
    baseURL: settings.base_url,
    apiKey: settings.api_key ?? undefined,
    fetch: tauriFetch
  });

  return provider(settings.model);
}

export function generationSettings(settings: LlmProfile) {
  return {
    maxOutputTokens: settings.max_output_tokens ?? undefined,
    temperature: settings.temperature ?? undefined,
    topP: settings.top_p ?? undefined
  };
}

export async function testOpenAiCompatibleConnection(settings: {
  apiKey?: string;
  baseUrl: string;
}) {
  const response = await tauriFetch(`${settings.baseUrl.replace(/\/$/, '')}/models`, {
    headers: settings.apiKey
      ? {
          Authorization: `Bearer ${settings.apiKey}`
        }
      : undefined,
    method: 'GET'
  });

  if (!response.ok) {
    throw new Error(`连接失败：HTTP ${response.status}`);
  }
}

export async function listOpenAiCompatibleModels(settings: {
  apiKey?: string;
  baseUrl: string;
}): Promise<ProviderModelInfo[]> {
  const response = await tauriFetch(`${settings.baseUrl.replace(/\/$/, '')}/models`, {
    headers: settings.apiKey
      ? {
          Authorization: `Bearer ${settings.apiKey}`
        }
      : undefined,
    method: 'GET'
  });

  if (!response.ok) {
    throw new Error(`模型列表拉取失败：HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: ProviderModelApiItem[];
    models?: Array<{ name?: unknown }>;
  };

  const data: ProviderModelApiItem[] =
    payload.data ??
    payload.models?.map((model) => ({
      id: model.name,
      name: model.name
    })) ??
    [];

  const models = data
    .map((model) => providerModelInfoFromApiItem(model, 'provider'))
    .filter((model) => model.id)
    .sort((left, right) => left.id.localeCompare(right.id));

  return enrichModelsWithOpenRouterCatalog(models, settings.baseUrl);
}

async function enrichModelsWithOpenRouterCatalog(
  models: ProviderModelInfo[],
  baseUrl: string
): Promise<ProviderModelInfo[]> {
  if (
    models.length === 0 ||
    models.every((model) => model.maxContextLength != null && model.maxOutputTokens != null)
  ) {
    return models;
  }

  const prefixes = catalogPrefixesForBaseUrl(baseUrl);
  if (prefixes.length === 0) {
    return models;
  }

  try {
    const response = await tauriFetch(OPENROUTER_MODELS_URL, { method: 'GET' });
    if (!response.ok) {
      return models;
    }

    const payload = (await response.json()) as { data?: ProviderModelApiItem[] };
    const catalog = new Map(
      (payload.data ?? [])
        .map((item) => [typeof item.id === 'string' ? item.id : '', item] as const)
        .filter(([id]) => id)
    );

    return models.map((model) => {
      const catalogItem = findCatalogItem(catalog, model.id, prefixes);
      if (!catalogItem) {
        return model;
      }
      return {
        ...model,
        maxContextLength:
          model.maxContextLength ??
          providerModelInfoFromApiItem(catalogItem, 'openrouter').maxContextLength,
        maxOutputTokens:
          model.maxOutputTokens ??
          (typeof catalogItem.top_provider?.max_completion_tokens === 'number'
            ? catalogItem.top_provider.max_completion_tokens
            : undefined),
        metadataSource: model.maxContextLength != null ? model.metadataSource : 'openrouter',
        modelContextLength:
          model.modelContextLength ??
          (typeof catalogItem.context_length === 'number' ? catalogItem.context_length : undefined),
        providerContextLength:
          model.providerContextLength ??
          (typeof catalogItem.top_provider?.context_length === 'number'
            ? catalogItem.top_provider.context_length
            : undefined)
      };
    });
  } catch {
    return models;
  }
}

export function providerModelInfoFromApiItem(
  model: ProviderModelApiItem,
  metadataSource: ProviderModelInfo['metadataSource']
): ProviderModelInfo {
  const modelContextLength =
    typeof model.context_length === 'number' ? model.context_length : undefined;
  const providerContextLength =
    typeof model.top_provider?.context_length === 'number'
      ? model.top_provider.context_length
      : undefined;
  return {
    id: typeof model.id === 'string' ? model.id : '',
    maxContextLength: modelContextLength ?? providerContextLength,
    maxOutputTokens:
      typeof model.top_provider?.max_completion_tokens === 'number'
        ? model.top_provider.max_completion_tokens
        : undefined,
    metadataSource,
    modelContextLength,
    name: typeof model.name === 'string' ? model.name : undefined,
    providerContextLength
  };
}

function catalogPrefixesForBaseUrl(baseUrl: string) {
  const normalized = baseUrl.toLowerCase();
  if (normalized.includes('openrouter')) {
    return [];
  }
  if (normalized.includes('openai')) {
    return ['openai'];
  }
  if (normalized.includes('deepseek')) {
    return ['deepseek'];
  }
  if (normalized.includes('moonshot')) {
    return ['moonshotai', 'moonshot'];
  }
  if (normalized.includes('volces') || normalized.includes('ark.cn-')) {
    return ['bytedance', 'doubao'];
  }
  if (normalized.includes('dashscope') || normalized.includes('aliyun')) {
    return ['qwen', 'alibaba', 'alibabacloud'];
  }
  if (normalized.includes('bigmodel')) {
    return ['z-ai', 'zhipuai', 'thudm'];
  }
  if (normalized.includes('hunyuan') || normalized.includes('tencent')) {
    return ['tencent'];
  }
  if (normalized.includes('minimax')) {
    return ['minimax'];
  }
  if (normalized.includes('anthropic')) {
    return ['anthropic'];
  }
  if (normalized.includes('google')) {
    return ['google'];
  }
  if (normalized.includes('mistral')) {
    return ['mistralai'];
  }
  return [];
}

function findCatalogItem(
  catalog: Map<string, ProviderModelApiItem>,
  modelId: string,
  prefixes: string[]
) {
  for (const prefix of prefixes) {
    const prefixed = catalog.get(`${prefix}/${modelId}`);
    if (prefixed) {
      return prefixed;
    }
  }
  return catalog.get(modelId);
}
