import { useCallback, useState } from 'react';

const STORAGE_PREFIX = 'neuink.reader.segmentNote';

export function useStoredCollapseState(
  preference: 'recordSourceCollapsed' | 'sourceCollapsed' | 'translationCollapsed',
  defaultCollapsed = true
) {
  const storageKey = `${STORAGE_PREFIX}.${preference}`;
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey, defaultCollapsed));

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // The preference remains available for this session when storage is blocked.
      }
      return next;
    });
  }, [storageKey]);

  return { collapsed, toggleCollapsed };
}

function readCollapsed(storageKey: string, defaultCollapsed: boolean) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === null ? defaultCollapsed : stored === 'true';
  } catch {
    return defaultCollapsed;
  }
}
