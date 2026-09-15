import { createContext, useContext } from 'react';
import type { PdfJumpRequest } from '../types';

export type ReadingNoteBinding = { title: string; onAddSource: (entryId: string, segmentUid: string) => Promise<void> };
export const ReadingSessionContext = createContext<{ active: boolean; resizing?: boolean; onReady: () => void; note?: ReadingNoteBinding; jump?: PdfJumpRequest } | null>(null);
export const useReadingSession = () => useContext(ReadingSessionContext);
