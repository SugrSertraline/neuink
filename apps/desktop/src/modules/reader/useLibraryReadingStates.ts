import { useEffect, useState } from 'react';
import { listReadingStates } from '@/shared/ipc/workspaceApi';
import { subscribeReadingStateUpdated } from '@/shared/lib/readingStateEvents';
import type { EntryReadingState } from '@/shared/types/domain';

const EMPTY: Record<string, EntryReadingState> = {};
export function useLibraryReadingStates(root: string | null, enabled = true) {
  const [snapshot, setSnapshot] = useState({ root, states: EMPTY, loading: Boolean(root && enabled), error: false });
  useEffect(() => {
    if (!root || !enabled) { setSnapshot({ root, states: EMPTY, loading: false, error: false }); return; }
    let cancelled = false;
    const updates: Record<string, EntryReadingState> = {};
    setSnapshot({ root, states: EMPTY, loading: true, error: false });
    const off = subscribeReadingStateUpdated(state => {
      updates[state.entry_id] = state;
      setSnapshot(value => ({ ...value, states: { ...value.states, [state.entry_id]: state } }));
    });
    void listReadingStates(root).then(states => {
      if (!cancelled) setSnapshot({ root, states: { ...Object.fromEntries(states.map(state => [state.entry_id, state])), ...updates }, loading: false, error: false });
    }).catch(() => { if (!cancelled) setSnapshot({ root, states: updates, loading: false, error: true }); });
    return () => { cancelled = true; off(); };
  }, [root, enabled]);
  return snapshot.root === root ? snapshot : { root, states: EMPTY, loading: Boolean(root && enabled), error: false };
}
