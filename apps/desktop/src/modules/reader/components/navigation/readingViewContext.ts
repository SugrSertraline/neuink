import { createContext, useContext } from 'react';
import type { WorkspaceSurface } from '@/app/workspaceSurface';
import type { ReadingLinkMode } from '@/shared/lib/readerPreferences';

export type ReadingViewSessionState = {
  mode: 'original' | 'replace';
  setMode: (mode: 'original' | 'replace') => void;
  active: boolean;
  group: string;
  id: string;
  kind: WorkspaceSurface['kind'];
  linkMode: ReadingLinkMode;
};

// Keep context identity outside the component refresh boundary. Otherwise a
// refreshed toolbar can use a new provider while non-component hooks retain
// the old context and silently fall back to the original PDF display.
export const ReadingViewContext = createContext<ReadingViewSessionState | null>(null);
export const useReadingViewSession = () => useContext(ReadingViewContext);
