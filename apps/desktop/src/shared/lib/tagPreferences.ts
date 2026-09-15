export type TagNavigationMode = 'directory' | 'paths' | 'tree';
export type TagDensity = 'compact' | 'comfortable';

export type TagPreferences = {
  navigationMode: TagNavigationMode;
  density: TagDensity;
  showCounts: boolean;
  onlyMostSpecificTags: boolean;
};

export const TAG_PREFERENCES_STORAGE_KEY = 'neuink.tagPreferences.v1';
export const DEFAULT_TAG_PREFERENCES: TagPreferences = {
  navigationMode: 'directory', density: 'compact', showCounts: true, onlyMostSpecificTags: true
};
export const TAG_NAVIGATION_LABELS: Record<TagNavigationMode, string> = {
  directory: '逐级目录', paths: '路径列表', tree: '树形导航'
};

export function normalizeTagPreferences(value: unknown): TagPreferences {
  const saved = value && typeof value === 'object' ? value as Partial<TagPreferences> : {};
  return {
    navigationMode: saved.navigationMode === 'tree' || saved.navigationMode === 'paths' ? saved.navigationMode : 'directory',
    density: saved.density === 'comfortable' ? 'comfortable' : 'compact',
    showCounts: typeof saved.showCounts === 'boolean' ? saved.showCounts : true,
    onlyMostSpecificTags: typeof saved.onlyMostSpecificTags === 'boolean' ? saved.onlyMostSpecificTags : true
  };
}

export function readStoredTagPreferences(): TagPreferences {
  if (typeof window === 'undefined') return DEFAULT_TAG_PREFERENCES;
  try {
    return normalizeTagPreferences(JSON.parse(window.localStorage.getItem(TAG_PREFERENCES_STORAGE_KEY) ?? 'null'));
  } catch {
    return DEFAULT_TAG_PREFERENCES;
  }
}

// Display projection only: keep the most specific assigned paths in every branch,
// not just global leaves. Never use this result to replace an entry's saved tags.
export function getVisibleEntryTags(paths: readonly string[], onlyMostSpecific: boolean): string[] {
  const unique = [...new Set(paths)];
  if (!onlyMostSpecific) return unique;
  const ancestors = new Set<string>();
  for (const path of unique) {
    let separator = path.lastIndexOf('/');
    while (separator > 0) {
      ancestors.add(path.slice(0, separator));
      separator = path.lastIndexOf('/', separator - 1);
    }
  }
  return unique.filter(path => !ancestors.has(path));
}

export function getEntryTagLabel(path: string, visiblePaths: readonly string[]): string {
  const leafName = (value: string) => {
    const parts = value.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? value;
  };
  const leaf = leafName(path);
  return visiblePaths.some(other => other !== path && leafName(other) === leaf) ? path : leaf;
}
