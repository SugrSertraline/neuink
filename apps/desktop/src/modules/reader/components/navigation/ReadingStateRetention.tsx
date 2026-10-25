import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { ReadingPosition } from './ReadingNavigation';
import { readReadingViewState, saveReadingViewState } from './readingViewStorage';

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
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly storageKey?: string) {
    for (const [key, position] of Object.entries(readReadingViewState(storageKey).positions)) {
      this.snapshots.set(key, { position, back: [], forward: [], lastJump: null });
    }
  }
  persist = (immediate = false) => {
    if (!this.storageKey) return;
    if (immediate) this.flush();
    else if (this.saveTimer === undefined) this.saveTimer = setTimeout(this.flush, 300);
  };
  flush = () => {
    clearTimeout(this.saveTimer); this.saveTimer = undefined;
    const positions = Object.fromEntries([...this.snapshots].flatMap(([key, snapshot]) => snapshot.position ? [[key, snapshot.position]] : []));
    saveReadingViewState(this.storageKey, { positions });
  };
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
export function ReadingStateRetention({ children, storageKey }: { children: ReactNode; storageKey?: string }) {
  const store = useRef<ReadingSnapshotStore>();
  if (!store.current) store.current = new ReadingSnapshotStore(storageKey);
  useEffect(() => () => store.current?.flush(), []);
  return <Context.Provider value={store.current}>{children}</Context.Provider>;
}
export function usePersistReadingSnapshot() { return useContext(Context)?.persist; }
export function useRetainedReadingSnapshot(key?: string) {
  const store = useContext(Context);
  const snapshot = useRef<ReadingSnapshot>();
  if (!snapshot.current) snapshot.current = key && store ? store.get(key) : { position: null, back: [], forward: [], lastJump: null };
  return snapshot.current;
}
