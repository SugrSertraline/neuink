import { expect, it, vi } from 'vitest';
import { loadPublicModelCatalog, resetPublicCatalogMemory } from './modelCatalogStore';

// Explicit, free network smoke test. Ordinary tests stay deterministic and offline.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) }));
it.skipIf(process.env.NEUINK_PUBLIC_CATALOG_LIVE !== '1')('normalizes both live public model directories without a key', async () => {
  resetPublicCatalogMemory();
  const result = await loadPublicModelCatalog(undefined, true);
  expect(result.warnings.filter(w => w.includes('更新失败'))).toEqual([]);
  const providers = new Set(result.models.map(m => m.providerId));
  expect(providers.size).toBeGreaterThan(100);
  expect(result.models.length).toBeGreaterThan(3000);
  for (const id of ['openai', 'anthropic', 'google', 'deepseek', 'openrouter']) expect(providers.has(id), id).toBe(true);
  expect(result.models.some(m => m.maxContextLength && m.maxOutputTokens)).toBe(true);
  console.info(`Public catalog: ${providers.size} providers, ${result.models.length} provider-model records; ${result.updatedAt}`);
}, 30000);
