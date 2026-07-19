import { getCurrentWebview } from '@tauri-apps/api/webview';

export const UI_SCALE_STORAGE_KEY = 'neuink.uiScale';
export const UI_SCALE_OPTIONS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

export type UiScale = (typeof UI_SCALE_OPTIONS)[number];

export function normalizeUiScale(value: unknown): UiScale {
  if (value == null || value === '') {
    return 1;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return UI_SCALE_OPTIONS.reduce((closest, candidate) =>
    Math.abs(candidate - numeric) < Math.abs(closest - numeric) ? candidate : closest
  );
}

export function readStoredUiScale(): UiScale {
  if (typeof window === 'undefined') {
    return 1;
  }
  return normalizeUiScale(window.localStorage.getItem(UI_SCALE_STORAGE_KEY));
}

export function persistUiScale(scale: UiScale) {
  window.localStorage.setItem(UI_SCALE_STORAGE_KEY, String(scale));
}

export async function applyUiScale(scale: UiScale) {
  if ('__TAURI_INTERNALS__' in window) {
    await getCurrentWebview().setZoom(scale);
    return;
  }
  document.documentElement.style.zoom = String(scale);
}

export function adjacentUiScale(scale: UiScale, direction: -1 | 1): UiScale {
  const index = UI_SCALE_OPTIONS.indexOf(scale);
  const nextIndex = Math.min(
    UI_SCALE_OPTIONS.length - 1,
    Math.max(0, index + direction)
  );
  return UI_SCALE_OPTIONS[nextIndex];
}
