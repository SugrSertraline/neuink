export const REFLOW_COMPONENT_KEYS = ['heading', 'paragraph', 'list', 'table', 'math', 'code', 'supportingText', 'figure', 'chart'] as const;
export type ReflowComponentKey = typeof REFLOW_COMPONENT_KEYS[number];
export type ReflowContentPreference = {
  image: boolean;
  translation: boolean;
  parsed: boolean;
  translationView: 'paragraph' | 'sentences';
};
// Legacy `original` meant an image for visuals, but parsed text for other types.
export type ReflowContentOverrides = Partial<ReflowContentPreference> & { original?: boolean };
export type ReflowComponentContent = Partial<Record<ReflowComponentKey, ReflowContentOverrides>>;

export function isVisualReflowComponent(key: ReflowComponentKey) {
  return key === 'figure' || key === 'chart' || key === 'table';
}

export function resolveReflowContent(key: ReflowComponentKey, mode: 'source' | 'translation' | 'bilingual',
  component?: ReflowContentOverrides, segment?: ReflowContentOverrides): ReflowContentPreference {
  return {
    image: isVisualReflowComponent(key),
    translation: mode !== 'source',
    parsed: !isVisualReflowComponent(key) && mode !== 'translation',
    translationView: 'paragraph',
    ...migrateContent(key, component),
    ...migrateContent(key, segment),
  };
}

function migrateContent(key: ReflowComponentKey, value?: ReflowContentOverrides): Partial<ReflowContentPreference> {
  if (!value) return {};
  const { original, ...current } = value;
  return { ...(typeof original === 'boolean' ? { [isVisualReflowComponent(key) ? 'image' : 'parsed']: original } : {}), ...current };
}

export function normalizeReflowContent(value: unknown): ReflowContentOverrides {
  if (!value || typeof value !== 'object') return {};
  const candidate = value as Record<string, unknown>;
  const result: ReflowContentOverrides = {};
  for (const key of ['image', 'original', 'translation', 'parsed'] as const) {
    if (typeof candidate[key] === 'boolean') result[key] = candidate[key];
  }
  if (candidate.translationView === 'paragraph' || candidate.translationView === 'sentences') result.translationView = candidate.translationView;
  return result;
}

export function normalizeReflowComponentContent(value: unknown): ReflowComponentContent {
  if (!value || typeof value !== 'object') return {};
  const candidate = value as Record<string, unknown>;
  return Object.fromEntries(REFLOW_COMPONENT_KEYS.flatMap(key => {
    const content = normalizeReflowContent(candidate[key]);
    return Object.keys(content).length ? [[key, content]] : [];
  }));
}
