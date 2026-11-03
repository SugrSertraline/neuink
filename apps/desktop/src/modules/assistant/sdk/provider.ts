import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { mergeModelMetadata, modelMetadataIndex, positiveLimit, type ModelFacts } from './modelCatalog';
import { loadPublicModelCatalog } from './modelCatalogStore';

import type { LlmApiProtocol, LlmProfile } from '@/shared/ipc/assistantApi';
import { resolveLlmApiProtocol } from '@/shared/ipc/assistantApi';

export type ProviderModelInfo = ModelFacts & {
  id: string;
  maxContextLength?: number;
  maxOutputTokens?: number;
  modelContextLength?: number;
  name?: string;
  providerContextLength?: number;
};

export type ProviderModelApiItem = {
  context_window?: unknown;
  inputTokenLimit?: unknown;
  outputTokenLimit?: unknown;
  max_input_tokens?: unknown;
  max_output_tokens?: unknown;
  context_length?: unknown;
  display_name?: unknown;
  id?: unknown;
  name?: unknown;
  top_provider?: { context_length?: unknown; max_completion_tokens?: unknown };
};

export function createNeuinkModel(settings: LlmProfile) {
  const apiKey = settings.api_key?.trim() || undefined;
  const common = { apiKey, baseURL: settings.base_url, fetch: tauriFetch };

  switch (resolveLlmApiProtocol(settings.api_protocol)) {
    case 'anthropic':
      return createAnthropic(common)(settings.model);
    case 'google':
      return createGoogleGenerativeAI(common)(settings.model);
    default:
      return createOpenAICompatible({ name: 'neuink', ...common })(settings.model);
  }
}

export function generationSettings(settings: LlmProfile) {
  const protocol = resolveLlmApiProtocol(settings.api_protocol);
  return {
    maxOutputTokens:
      settings.max_output_tokens ?? (protocol === 'anthropic' ? 4_096 : undefined),
    temperature: settings.temperature ?? undefined,
    topP: settings.top_p ?? undefined
  };
}

const ANTHROPIC_MODELS_VERSION = '2023-06-01';

type ProtocolAwareConnectionSettings = {
  apiKey?: string;
  apiProtocol?: LlmApiProtocol;
  baseUrl: string;
};

function modelsRequestInit(
  settings: ProtocolAwareConnectionSettings
): { headers?: Record<string, string> } {
  const apiKey = settings.apiKey?.trim();
  switch (resolveLlmApiProtocol(settings.apiProtocol)) {
    case 'anthropic':
      return {
        headers: apiKey
          ? { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_MODELS_VERSION }
          : { 'anthropic-version': ANTHROPIC_MODELS_VERSION }
      };
    case 'google':
      return apiKey ? { headers: { 'x-goog-api-key': apiKey } } : {};
    default:
      return apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {};
  }
}

function modelsListUrl(settings: ProtocolAwareConnectionSettings) {
  const base = settings.baseUrl.replace(/\/$/, '');
  if (
    resolveLlmApiProtocol(settings.apiProtocol) === 'google' &&
    !base.endsWith('/models')
  ) {
    return `${base}/models?pageSize=1000`;
  }
  return `${base}/models`;
}

export async function testOpenAiCompatibleConnection(settings: {
  apiKey?: string;
  apiProtocol?: LlmApiProtocol;
  baseUrl: string;
}) {
  const response = await tauriFetch(modelsListUrl(settings), {
    headers: modelsRequestInit(settings)?.headers,
    method: 'GET'
  });

  if (!response.ok) {
    throw new Error(`连接失败：HTTP ${response.status}`);
  }
}

export async function listOpenAiCompatibleModels(settings: {
  apiKey?: string;
  apiProtocol?: LlmApiProtocol;
  baseUrl: string;
  signal?: AbortSignal;
}): Promise<ProviderModelInfo[]> {
  const response = await tauriFetch(modelsListUrl(settings), {
    headers: modelsRequestInit(settings)?.headers,
    method: 'GET', signal: settings.signal
  });

  if (!response.ok) {
    throw new Error(`模型列表拉取失败：HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    data?: ProviderModelApiItem[];
    models?: Array<ProviderModelApiItem>;
  };

  const data: ProviderModelApiItem[] =
    payload.data ??
    payload.models?.map((model) => ({
      ...model,
      id: stripGoogleModelPrefix(model.name),
      display_name: stripGoogleModelPrefix(model.name)
    })) ??
    [];

  const models = data
    .map((model) => providerModelInfoFromApiItem(model, 'provider'))
    .filter((model) => model.id)
    .sort((left, right) => left.id.localeCompare(right.id));

  return enrichModelsWithPublicCatalog(models, settings.baseUrl, settings.signal);
}

function stripGoogleModelPrefix(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/^models\//, '') : undefined;
}

async function enrichModelsWithPublicCatalog(models: ProviderModelInfo[], baseUrl: string, signal?: AbortSignal): Promise<ProviderModelInfo[]> {
  try {
    const catalog = await loadPublicModelCatalog(signal);
    const index = modelMetadataIndex(catalog.models, baseUrl);
    return models.map(model => mergeModelMetadata(model, index.get(model.id)));
  } catch {
    signal?.throwIfAborted();
    return models;
  }
}

export function providerModelInfoFromApiItem(model: ProviderModelApiItem, metadataSource: ProviderModelInfo['metadataSource']): ProviderModelInfo {
  const modelContextLength = positiveLimit(model.context_length ?? model.context_window);
  const providerContextLength = positiveLimit(model.top_provider?.context_length);
  return {
    id: typeof model.id === 'string' ? model.id : '',
    maxContextLength: providerContextLength ?? modelContextLength,
    maxInputTokens: positiveLimit(model.inputTokenLimit ?? model.max_input_tokens),
    maxOutputTokens: positiveLimit(model.top_provider?.max_completion_tokens ?? model.outputTokenLimit ?? model.max_output_tokens),
    metadataSource, contextSource: metadataSource, outputSource: metadataSource, modelContextLength, providerContextLength,
    name: typeof model.display_name === 'string' ? model.display_name : typeof model.name === 'string' ? model.name : undefined
  };
}
