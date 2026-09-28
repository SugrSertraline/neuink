import { fetch as nativeFetch } from '@tauri-apps/plugin-http';
import { combineCatalogs, parseModelsDev, parseOpenRouter, positiveLimit, type PublicModelCatalog, type CatalogModel } from './modelCatalog';

const KEY = 'neuink.publicModelCatalog.v1';
export const CATALOG_TTL = 24 * 60 * 60 * 1000;
const MAX_BYTES = 16 * 1024 * 1024;
let memory: PublicModelCatalog | undefined;

function validCachedModel(value: unknown): value is CatalogModel {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  if (!['id', 'providerId', 'providerName'].every(k => typeof m[k] === 'string' && !!m[k] && m[k].length <= 300)) return false;
  if (!['maxContextLength', 'maxOutputTokens', 'maxInputTokens', 'modelContextLength', 'providerContextLength'].every(k => m[k] == null || positiveLimit(m[k]) != null)) return false;
  if (!['label', 'providerApi', 'providerNpm', 'status', 'releaseDate', 'knowledge'].every(k => m[k] == null || (typeof m[k] === 'string' && m[k].length <= 500))) return false;
  if (!['supportsTools', 'supportsReasoning', 'supportsTemperature'].every(k => m[k] == null || typeof m[k] === 'boolean')) return false;
  if (!['inputModalities', 'outputModalities'].every(k => m[k] == null || (Array.isArray(m[k]) && m[k].length <= 12 && m[k].every(v => typeof v === 'string' && v.length <= 30)))) return false;
  return ['metadataSource', 'contextSource', 'outputSource'].every(k => m[k] == null || ['built_in', 'provider', 'models_dev', 'openrouter'].includes(String(m[k])));
}

export function readPublicModelCatalog(): PublicModelCatalog | undefined {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw || raw.length > 6_000_000) return undefined;
    const c = JSON.parse(raw) as PublicModelCatalog;
    if (c.version !== 1 || !Number.isFinite(Date.parse(c.updatedAt)) || Date.parse(c.updatedAt) > Date.now() + 300_000 || !Array.isArray(c.models) || !c.models.length || c.models.length > 30_000) return undefined;
    if (!c.models.every(validCachedModel)) return undefined;
    memory = { version: 1, updatedAt: c.updatedAt, models: c.models,
      warnings: Array.isArray(c.warnings) ? c.warnings.filter(w => typeof w === 'string').slice(0, 5).map(w => w.slice(0, 300)) : [] };
    return memory;
  } catch { return undefined; }
}

async function download(url: string, outer?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer?.throwIfAborted(); outer?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 12_000);
  try {
    // These fixed public URLs never receive the user's key, provider URL or model query.
    const response = await nativeFetch(url, { method: 'GET', signal: controller.signal, credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('目录超过大小限制');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('目录响应为空');
    const decoder = new TextDecoder(); let text = ''; let bytes = 0;
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error('目录超过大小限制');
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode(); return JSON.parse(text);
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  } finally { clearTimeout(timer); outer?.removeEventListener('abort', abort); }
}

export async function loadPublicModelCatalog(signal?: AbortSignal, force = false): Promise<PublicModelCatalog> {
  signal?.throwIfAborted();
  const old = readPublicModelCatalog();
  if (!force && old && Date.now() - Date.parse(old.updatedAt) < (old.warnings.length ? 60 * 60 * 1000 : CATALOG_TTL)) return old;
  const sources = await Promise.allSettled([
    download('https://models.dev/api.json', signal).then(parseModelsDev),
    download('https://openrouter.ai/api/v1/models', signal).then(parseOpenRouter),
  ]);
  signal?.throwIfAborted();
  const warnings: string[] = [];
  const rows = sources.map((result, i): CatalogModel[] => {
    const name = i ? 'OpenRouter' : 'models.dev';
    if (result.status === 'fulfilled' && result.value.length) return result.value;
    warnings.push(`${name} 更新失败，保留可用缓存或其他来源。`);
    return old?.models.filter(m => i ? m.providerId === 'openrouter' : m.providerId !== 'openrouter') ?? [];
  });
  if (sources.every(r => r.status === 'rejected' || !r.value.length)) {
    if (old) { memory = { ...old, warnings }; return memory; }
    throw new Error('公开模型目录暂不可用，可重试、使用内置预设或手动填写。');
  }
  const result: PublicModelCatalog = { version: 1, updatedAt: new Date().toISOString(), models: combineCatalogs(rows[0], rows[1]), warnings };
  memory = result;
  try {
    const encoded = JSON.stringify(result);
    if (encoded.length > 6_000_000) throw new Error('cache too large');
    localStorage.setItem(KEY, encoded);
  } catch { result.warnings.push('本机缓存空间不足，本次目录仅在当前窗口使用。'); }
  return result;
}

/** Test isolation; no settings/credentials are stored in this cache. */
export function resetPublicCatalogMemory() { memory = undefined; }
