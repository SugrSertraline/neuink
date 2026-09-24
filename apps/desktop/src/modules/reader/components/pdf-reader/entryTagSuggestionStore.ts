import type { TagRecommendation } from '@/shared/ipc/assistantApi';

type Snapshot = {
  recommendations: TagRecommendation[]; selectedPaths: string[]; generatedAt: string | null;
  phase: 'idle' | 'generating' | 'applying'; error: string | null;
};
const snapshots = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
const prefix = 'neuink.entryTagRecommendations.v1:';
export const tagSuggestionKey = (root: string | null, entryId: string) => JSON.stringify([root, entryId]);
export function subscribeTagSuggestions(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const empty = (): Snapshot => ({ recommendations: [], selectedPaths: [], generatedAt: null, phase: 'idle', error: null });

/** A local suggestion cache, never the authority for the entry's applied tags. */
export function readTagSuggestions(key: string): Snapshot {
  const current = snapshots.get(key); if (current) return current;
  let snapshot = empty();
  try {
    const saved = JSON.parse(window.localStorage.getItem(prefix + key) ?? 'null');
    if (saved && typeof saved.generatedAt === 'string' && Array.isArray(saved.recommendations)) {
      const recommendations = saved.recommendations.filter((tag: TagRecommendation) => tag && typeof tag.path === 'string' && typeof tag.reason === 'string' && typeof tag.dimension === 'string' && typeof tag.confidence === 'number' && ['new', 'existing'].includes(tag.source));
      snapshot = { ...snapshot, recommendations, generatedAt: saved.generatedAt,
        selectedPaths: Array.isArray(saved.selectedPaths) ? saved.selectedPaths.filter((path: unknown) => typeof path === 'string' && recommendations.some((tag: TagRecommendation) => tag.path === path)) : [] };
    }
  } catch { /* A missing or invalid cache is an ungenerated state, never applied data. */ }
  snapshots.set(key, snapshot); return snapshot;
}
export function updateTagSuggestions(key: string, patch: Partial<Snapshot>, persist = false) {
  const next = { ...readTagSuggestions(key), ...patch };
  if (persist) {
    try { window.localStorage.setItem(prefix + key, JSON.stringify({ recommendations: next.recommendations, selectedPaths: next.selectedPaths, generatedAt: next.generatedAt })); }
    catch { next.error = '结果已保留在当前会话，但本机缓存写入失败；重启后可能需要重新生成。'; }
  }
  snapshots.set(key, next); listeners.forEach(listener => listener());
}
export function beginTagSuggestionTask(key: string, phase: 'generating' | 'applying') {
  if (readTagSuggestions(key).phase !== 'idle') return false;
  updateTagSuggestions(key, { phase, error: null }); return true;
}
