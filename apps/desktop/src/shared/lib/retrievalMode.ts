import * as ipc from '@/shared/ipc/workspaceApi';
import type { MultivectorPoolSettings, RetrievalSettingsState } from '@/shared/ipc/workspaceApi';

export const DEFAULT_MULTIVECTOR: MultivectorPoolSettings = {
  enabled: false,
  mode: 'bge_m3_hybrid',
  max_full_scope_segments: 600,
  rescore_window: 100
};

/**
 * Cached view of the "use the composed retrieval path" flag.
 *
 * Tool creation happens on every assistant turn, and an IPC round trip per turn just to
 * answer one boolean would be waste, so the value is read once and cached; a save through
 * this module replaces the cache. The backend stays authoritative: a settings file edited
 * outside the app is picked up on the next launch, like every other setting.
 *
 * The IPC surface is accessed through the module namespace and inside `try`, so a test
 * that mocks only the calls it needs keeps working and fails closed to the batch path
 * instead of exploding at import time.
 */
let cached: Promise<boolean> | null = null;
let cachedSettings: RetrievalSettingsState | null = null;

export function readUnifiedRetrieval(): Promise<boolean> {
  if (!cached) {
    cached = (async () => {
      try {
        const settings = await ipc.getRetrievalSettings();
        cachedSettings = settings;
        return settings.unified;
      } catch {
        // A failed read must not silently switch retrieval paths.
        cached = null;
        return false;
      }
    })();
  }
  return cached;
}

export async function writeUnifiedRetrieval(unified: boolean): Promise<boolean> {
  const current = cachedSettings ?? { unified, multivector: DEFAULT_MULTIVECTOR };
  const saved = await ipc.saveRetrievalSettings({
    unified,
    multivector: current.multivector ?? DEFAULT_MULTIVECTOR
  });
  cachedSettings = saved;
  cached = Promise.resolve(saved.unified);
  return saved.unified;
}

export async function readRetrievalSettings(): Promise<RetrievalSettingsState> {
  const settings = await ipc.getRetrievalSettings();
  cachedSettings = settings;
  return {
    ...settings,
    multivector: settings.multivector ?? DEFAULT_MULTIVECTOR
  };
}

export async function writeRetrievalSettings(settings: RetrievalSettingsState): Promise<RetrievalSettingsState> {
  const saved = await ipc.saveRetrievalSettings({
    unified: settings.unified,
    multivector: settings.multivector ?? DEFAULT_MULTIVECTOR
  });
  cachedSettings = saved;
  cached = Promise.resolve(saved.unified);
  return saved;
}

/** Test seam: drop the cache so a new read hits the backend. */
export function resetUnifiedRetrievalCache(): void {
  cachedSettings = null;
  cached = null;
}
