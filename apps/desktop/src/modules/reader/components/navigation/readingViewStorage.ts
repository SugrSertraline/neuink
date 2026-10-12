import type { ReadingPosition } from './ReadingNavigation';

export type ReadingViewState = { mode: 'original' | 'replace'; positions: Record<string, ReadingPosition> };
export const readingViewStorageKey = (root: string | null, view: string) => root ? `neuink.reading.view:${JSON.stringify([root, view])}` : undefined;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function position(value: unknown): ReadingPosition | null {
  if (!record(value) || !Number.isSafeInteger(value.pageIdx) || !finite(value.pageIdx, 0, 1_000_000)
    || !finite(value.offset, -10, 10) || !finite(value.left, 0, 10_000_000)) return null;
  return { pageIdx: value.pageIdx, offset: value.offset, left: value.left,
    ...(typeof value.segmentUid === 'string' && value.segmentUid.length <= 512 ? { segmentUid: value.segmentUid } : {}),
    ...(finite(value.segmentOffset, -10, 10) ? { segmentOffset: value.segmentOffset } : {}),
    ...(finite(value.zoom, .1, 10) ? { zoom: value.zoom } : {}) };
}

export function readReadingViewState(key?: string): ReadingViewState {
  const empty: ReadingViewState = { mode: 'original', positions: {} };
  if (!key) return empty;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw || raw.length > 64_000) return empty;
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1) return empty;
    const positions = record(value.positions) ? Object.fromEntries(Object.entries(value.positions).slice(-8).flatMap(([id, item]) => {
      const valid = id.length <= 2048 ? position(item) : null;
      return valid ? [[id, valid]] : [];
    })) : {};
    return { mode: value.mode === 'replace' ? 'replace' : 'original', positions };
  } catch { return empty; }
}

/** Each owner merges only its own fields; a delayed position flush must preserve the latest display mode. */
export function saveReadingViewState(key: string | undefined, patch: Partial<ReadingViewState>): boolean {
  if (!key) return true;
  try { window.localStorage.setItem(key, JSON.stringify({ version: 1, ...readReadingViewState(key), ...patch })); return true; }
  catch { return false; }
}
