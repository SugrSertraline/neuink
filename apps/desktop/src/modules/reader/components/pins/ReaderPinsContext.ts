import { createContext, useContext } from 'react';
import type { SourceSegment } from '@/shared/types/domain';

export const ReaderPinsContext = createContext<{
  pin: (segment: SourceSegment) => void;
  has: (uid: string) => boolean;
} | null>(null);
export const useReaderPins = () => useContext(ReaderPinsContext);
