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
  { id: 'blue', label: '蓝色', swatch: '#0f62fe' },
  { id: 'zinc', label: '锌灰', swatch: '#18181b' },
  { id: 'slate', label: '石板灰', swatch: '#334155' },
  { id: 'neutral', label: '中性灰', swatch: '#262626' },
  { id: 'stone', label: '暖石灰', swatch: '#57534e' },
  { id: 'green', label: '绿色', swatch: '#16a34a' },
  { id: 'orange', label: '橙色', swatch: '#ea580c' },
  { id: 'rose', label: '玫瑰红', swatch: '#e11d48' },
  { id: 'violet', label: '紫色', swatch: '#7c3aed' }
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
