export type AppThemePresetId =
  | 'blue'
  | 'zinc'
  | 'slate'
  | 'neutral'
  | 'stone'
  | 'green'
  | 'orange'
  | 'rose'
  | 'violet';

export type AppThemePreset = {
  id: AppThemePresetId;
  label: string;
  swatch: string;
};

export const APP_THEME_STORAGE_KEY = 'neuink.themePreset';

export const APP_THEME_PRESETS: AppThemePreset[] = [
  { id: 'blue', label: 'Blue', swatch: '#0f62fe' },
  { id: 'zinc', label: 'Zinc', swatch: '#18181b' },
  { id: 'slate', label: 'Slate', swatch: '#334155' },
  { id: 'neutral', label: 'Neutral', swatch: '#262626' },
  { id: 'stone', label: 'Stone', swatch: '#57534e' },
  { id: 'green', label: 'Green', swatch: '#16a34a' },
  { id: 'orange', label: 'Orange', swatch: '#ea580c' },
  { id: 'rose', label: 'Rose', swatch: '#e11d48' },
  { id: 'violet', label: 'Violet', swatch: '#7c3aed' }
];

export function isAppThemePresetId(value: string | null): value is AppThemePresetId {
  return APP_THEME_PRESETS.some((preset) => preset.id === value);
}

export function readStoredThemePreset() {
  if (typeof window === 'undefined') {
    return 'blue';
  }
  const saved = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
  return isAppThemePresetId(saved) ? saved : 'blue';
}
