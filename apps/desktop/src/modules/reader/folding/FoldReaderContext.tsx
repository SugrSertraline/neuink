import { createContext, useContext, type ReactNode } from 'react';
import type { FoldReader } from './useFoldReader';
const Context = createContext<FoldReader | null>(null);
export function FoldReaderProvider({ value, children }: { value: FoldReader; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useFoldReaderContext() { return useContext(Context); }
