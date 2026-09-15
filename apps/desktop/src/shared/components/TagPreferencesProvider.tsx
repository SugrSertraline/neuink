import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_TAG_PREFERENCES, normalizeTagPreferences, readStoredTagPreferences, TAG_PREFERENCES_STORAGE_KEY, type TagPreferences } from '@/shared/lib/tagPreferences';

type TagPreferencesContextValue = {
  preferences: TagPreferences;
  persistenceError: string | null;
  updatePreferences: (patch: Partial<TagPreferences>) => void;
};

const TagPreferencesContext = createContext<TagPreferencesContextValue>({
  preferences: DEFAULT_TAG_PREFERENCES, persistenceError: null, updatePreferences: () => undefined
});

export function TagPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(readStoredTagPreferences);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const current = useRef(preferences);
  const updatePreferences = useCallback((patch: Partial<TagPreferences>) => {
    const next = normalizeTagPreferences({ ...current.current, ...patch });
    current.current = next;
    setPreferences(next);
    try {
      window.localStorage.setItem(TAG_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
      setPersistenceError(null);
    } catch {
      setPersistenceError('显示偏好已临时应用，但无法保存；重启后可能恢复默认。');
    }
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== TAG_PREFERENCES_STORAGE_KEY) return;
      const next = readStoredTagPreferences();
      current.current = next;
      setPreferences(next);
      setPersistenceError(null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(() => ({ preferences, persistenceError, updatePreferences }), [preferences, persistenceError, updatePreferences]);
  return <TagPreferencesContext.Provider value={value}>{children}</TagPreferencesContext.Provider>;
}

export function useTagPreferences() {
  return useContext(TagPreferencesContext);
}
