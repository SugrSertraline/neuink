import { createContext, useContext } from 'react';
import type { DailyState } from '@/shared/types/daily';
import type { NoteTarget } from '@/shared/types/domain';
import type { SourceLinkOpenTarget } from '@/modules/notes/editor/SourceLinkNode';

export type DailyModel = {
  root: string | null; state: DailyState | null; date: string; today: string;
  selectDate: (date: string) => void; loading: boolean; busy: boolean; error: string | null;
  mutate: (change: (state: DailyState) => DailyState) => Promise<boolean>;
  retry: () => void; reload: () => void; openNote: (target: NoteTarget, title?: string) => void;
  openSource?: (source: SourceLinkOpenTarget) => void;
};
// Keep the data contract independent of nested providers to avoid circular context initialization.
export const DailyModelContext = createContext<DailyModel | null>(null);
export const useDaily = () => useContext(DailyModelContext);
