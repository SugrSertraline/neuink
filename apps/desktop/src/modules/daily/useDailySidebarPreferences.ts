import { useCallback, useEffect, useRef, useState } from 'react';
import { DAILY_SIDEBAR_KEY, normalizeDailySidebar, type DailySidebarPreferences } from './dailyLifestyle';
import { FOOD_CATEGORIES } from './foodCatalog';
const changed = 'neuink:daily-sidebar-preferences';
function retainMenus(next: DailySidebarPreferences, previous: DailySidebarPreferences) {
  if (next.meals.join('\n') === previous.meals.join('\n')) next.meals = previous.meals;
  for (const { id } of FOOD_CATEGORIES) {
    if (id !== 'meal' && next.foodMenus[id].join('\n') === previous.foodMenus[id].join('\n')) next.foodMenus[id] = previous.foodMenus[id];
  }
}
function read() {
  try { return normalizeDailySidebar(JSON.parse(localStorage.getItem(DAILY_SIDEBAR_KEY) ?? 'null')); }
  catch { return normalizeDailySidebar(null); }
}
export function useDailySidebarPreferences() {
  const [preferences, setPreferences] = useState(read);
  const current = useRef(preferences); current.current = preferences;
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    const sync = (event: Event) => {
      const next = event instanceof CustomEvent ? normalizeDailySidebar(event.detail) : read();
      retainMenus(next, current.current);
      current.current = next; setPreferences(next);
    };
    const storage = (event: StorageEvent) => { if (event.key === DAILY_SIDEBAR_KEY || event.key === null) sync(event); };
    window.addEventListener(changed, sync); window.addEventListener('storage', storage);
    return () => { window.removeEventListener(changed, sync); window.removeEventListener('storage', storage); };
  }, []);
  const update = useCallback((change: (previous: DailySidebarPreferences) => DailySidebarPreferences) => {
    const next = normalizeDailySidebar(change(current.current));
    retainMenus(next, current.current);
    current.current = next; setPreferences(next);
    let saved = false;
    try { localStorage.setItem(DAILY_SIDEBAR_KEY, JSON.stringify(next)); setSaveError(''); saved = true; }
    catch { setSaveError('本次设置已生效，但未能保存到本机。'); }
    window.dispatchEvent(new CustomEvent(changed, { detail: next }));
    return saved;
  }, []);
  return { preferences, update, saveError };
}
