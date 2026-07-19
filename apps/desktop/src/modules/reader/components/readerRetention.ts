import type { WorkspaceSurface } from '@/app/workspaceSurface';

export const HEAVY_READER_IDLE_UNMOUNT_MS = 5 * 60 * 1000;
export const HEAVY_READER_SWEEP_INTERVAL_MS = 5 * 1000;

export function isHeavyReaderSurface(surface: WorkspaceSurface) {
  return surface.kind === 'pdf' || surface.kind === 'reflow';
}

export function hasHeavyReaderIdleExpired(inactiveSince: number, now: number) {
  return now - inactiveSince >= HEAVY_READER_IDLE_UNMOUNT_MS;
}
