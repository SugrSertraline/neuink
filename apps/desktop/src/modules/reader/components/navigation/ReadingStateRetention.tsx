import { createContext, useContext, useRef, type ReactNode } from 'react';
import type { ReadingPosition } from './ReadingNavigation';

export type ReadingSnapshot = {
  position: ReadingPosition | null;
  back: ReadingPosition[];
  forward: ReadingPosition[];
  lastJump: string | null;
};

// One store per live workspace tab, outside the idle-unmounted heavy reader.
// Values contain only numbers/strings, never DOM, PDF documents or callbacks.
export class ReadingSnapshotStore {
  private readonly snapshots = new Map<string, ReadingSnapshot>();
  get size() { return this.snapshots.size; }
  get(key: string): ReadingSnapshot {
    const snapshot = this.snapshots.get(key) ?? { position: null, back: [], forward: [], lastJump: null };
    this.snapshots.delete(key);
    this.snapshots.set(key, snapshot);
    // Embedded tag readers may visit many entries within a single tab.
    while (this.snapshots.size > 8) this.snapshots.delete(this.snapshots.keys().next().value!);
    return snapshot;
  }
}
const Context = createContext<ReadingSnapshotStore | null>(null);
export function ReadingStateRetention({ children }: { children: ReactNode }) {
  const store = useRef<ReadingSnapshotStore>();
  if (!store.current) store.current = new ReadingSnapshotStore();
  return <Context.Provider value={store.current}>{children}</Context.Provider>;
}
export function useRetainedReadingSnapshot(key?: string) {
  const store = useContext(Context);
  const snapshot = useRef<ReadingSnapshot>();
  if (!snapshot.current) snapshot.current = key && store ? store.get(key) : { position: null, back: [], forward: [], lastJump: null };
  return snapshot.current;
}
