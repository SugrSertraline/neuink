import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { appearanceLogos } from '../assets/appearance';
import { useWindowIcon } from '../hooks/useWindowIcon';
import { useGlassMaterial } from '../hooks/useGlassMaterial';

export type AppAppearance = 'standard' | 'atelier' | 'liquid-glass';
export const APP_APPEARANCE_STORAGE_KEY = 'neuink.appearance.v1';
export const GLASS_TRANSPARENCY_STORAGE_KEY = 'neuink.liquidGlass.reducedTransparency';
const SHELF_STORAGE_KEY = 'neuink.atelier.libraryDisplay';

function readStored(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch { return false; }
}

type AppearanceContextValue = {
  appearance: AppAppearance;
  setAppearance: (appearance: AppAppearance) => boolean;
  libraryDisplay: 'shelf' | 'list';
  setLibraryDisplay: (display: 'shelf' | 'list') => void;
  glassReducedTransparency: boolean;
  setGlassReducedTransparency: (reduced: boolean) => boolean;
};

// Existing isolated components/previews keep their original appearance without a provider.
const AppearanceContext = createContext<AppearanceContextValue>({
  appearance: 'standard', setAppearance: () => false,
  libraryDisplay: 'shelf', setLibraryDisplay: () => undefined,
  glassReducedTransparency: false, setGlassReducedTransparency: () => false
});

/** A material layer independent of accent presets, workspace data and editor sessions. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, updateAppearance] = useState<AppAppearance>(() => {
    const saved = readStored(APP_APPEARANCE_STORAGE_KEY);
    return saved === 'atelier' || saved === 'liquid-glass' ? saved : 'standard';
  });
  const [glassReducedTransparency, updateGlassReducedTransparency] = useState(() =>
    readStored(GLASS_TRANSPARENCY_STORAGE_KEY) === 'true');
  const [libraryDisplay, updateLibraryDisplay] = useState<'shelf' | 'list'>(() =>
    readStored(SHELF_STORAGE_KEY) === 'list' ? 'list' : 'shelf');

  useWindowIcon(appearanceLogos[appearance]);
  useGlassMaterial(appearance === 'liquid-glass' && !glassReducedTransparency);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-appearance');
    const previousTransparency = root.getAttribute('data-glass-transparency');
    if (appearance !== 'standard') root.setAttribute('data-appearance', appearance);
    else root.removeAttribute('data-appearance');
    if (appearance === 'liquid-glass' && glassReducedTransparency) root.setAttribute('data-glass-transparency', 'reduced');
    else root.removeAttribute('data-glass-transparency');
    // Mount on html so Radix/viewport portals inherit the same material tokens.
    return () => {
      if (previous === null) root.removeAttribute('data-appearance');
      else root.setAttribute('data-appearance', previous);
      if (previousTransparency === null) root.removeAttribute('data-glass-transparency');
      else root.setAttribute('data-glass-transparency', previousTransparency);
    };
  }, [appearance, glassReducedTransparency]);

  const setAppearance = useCallback((next: AppAppearance) => {
    updateAppearance(next);
    // Only explicit commands persist. Do not migrate the standalone Demo preference.
    return writeStored(APP_APPEARANCE_STORAGE_KEY, next === 'standard' ? null : next);
  }, []);
  const setLibraryDisplay = useCallback((next: 'shelf' | 'list') => {
    updateLibraryDisplay(next);
    writeStored(SHELF_STORAGE_KEY, next);
  }, []);
  const setGlassReducedTransparency = useCallback((reduced: boolean) => {
    updateGlassReducedTransparency(reduced);
    return writeStored(GLASS_TRANSPARENCY_STORAGE_KEY, reduced ? 'true' : null);
  }, []);
  const value = useMemo(() => ({ appearance, setAppearance, libraryDisplay, setLibraryDisplay, glassReducedTransparency, setGlassReducedTransparency }),
    [appearance, setAppearance, libraryDisplay, setLibraryDisplay, glassReducedTransparency, setGlassReducedTransparency]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() { return useContext(AppearanceContext); }
