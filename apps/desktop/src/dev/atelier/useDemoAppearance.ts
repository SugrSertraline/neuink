import { useCallback, useState } from 'react';

export type DemoSkin = 'classic' | 'atelier';

// Demo-only preference. Never read or change the production application's theme key.
const appearanceKey = 'neuink:atelier-demo:appearance';

function readAppearance(): DemoSkin {
  try {
    return window.localStorage.getItem(appearanceKey) === 'atelier' ? 'atelier' : 'classic';
  } catch {
    // A browser that blocks storage can still run the demo for the current page.
    return 'classic';
  }
}

export function useDemoAppearance() {
  const [skin, updateSkin] = useState<DemoSkin>(readAppearance);
  const setSkin = useCallback((next: DemoSkin): boolean => {
    updateSkin(next);
    // Persist only an explicit command/exit action, never initialization or typing.
    try {
      if (next === 'atelier') window.localStorage.setItem(appearanceKey, next);
      else window.localStorage.removeItem(appearanceKey);
      return true;
    } catch {
      return false;
    }
  }, []);
  return { skin, setSkin };
}
