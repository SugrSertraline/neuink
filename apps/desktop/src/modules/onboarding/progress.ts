import { GUIDE_STEPS } from './catalog';
export const GUIDE_STORAGE_KEY = 'neuink.onboarding.v1';
export const GUIDE_OPEN_EVENT = 'neuink:open-onboarding';
export const GUIDE_PROGRESS_EVENT = 'neuink:onboarding-progress';
export const GUIDE_MINERU_TUTORIAL_EVENT = 'neuink:onboarding-mineru-tutorial-opened';
export type GuideProgress = { version: 1; current: string; completed: string[]; skipped: string[]; seen: boolean; entryId: string | null; root: string | null };
export const freshProgress = (): GuideProgress => ({ version:1, current:GUIDE_STEPS[0].id, completed:[], skipped:[], seen:false, entryId:null, root:null });
export function readProgress(storageKey = GUIDE_STORAGE_KEY): GuideProgress {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (value?.version !== 1) return freshProgress();
    const ids = new Set(GUIDE_STEPS.map(step => step.id));
    const list = (items: unknown): string[] => Array.isArray(items) ? [...new Set(items.filter((id): id is string => typeof id === 'string' && ids.has(id)))] : [];
    const completed = list(value.completed);
    return { version:1, current:value.current === 'import' ? 'open-pdf' : ids.has(value.current) ? value.current : GUIDE_STEPS[0].id,
      completed, skipped:list(value.skipped).filter(id => !completed.includes(id)), seen:value.seen === true,
      entryId:typeof value.entryId === 'string' ? value.entryId : null, root:typeof value.root === 'string' ? value.root : null };
  } catch { return freshProgress(); }
}
export function resolveStep(progress: GuideProgress, skipped: boolean): GuideProgress {
  const index = GUIDE_STEPS.findIndex(step => step.id === progress.current);
  const completed = progress.completed.filter(id => id !== progress.current);
  const skips = progress.skipped.filter(id => id !== progress.current);
  return { ...progress, seen:true, completed:skipped ? completed : [...completed, progress.current],
    skipped:skipped ? [...skips, progress.current] : skips,
    current:GUIDE_STEPS[Math.min(index + 1, GUIDE_STEPS.length - 1)].id };
}
export function openOnboarding(reset = false) { window.dispatchEvent(new CustomEvent(GUIDE_OPEN_EVENT, { detail:{ reset } })); }
