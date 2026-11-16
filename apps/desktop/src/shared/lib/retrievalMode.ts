import * as ipc from '@/shared/ipc/workspaceApi';

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

export function readUnifiedRetrieval(): Promise<boolean> {
  if (!cached) {
    cached = (async () => {
      try {
        const settings = await ipc.getRetrievalSettings();
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
  const saved = await ipc.saveRetrievalSettings({ unified });
  cached = Promise.resolve(saved.unified);
  return saved.unified;
}

/** Test seam: drop the cache so a new read hits the backend. */
export function resetUnifiedRetrievalCache(): void {
  cached = null;
}
