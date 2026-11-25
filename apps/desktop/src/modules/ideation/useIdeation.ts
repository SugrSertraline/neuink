import { sameIdeationData } from './sameIdeationData';
import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { readIdeation, saveIdeation, type IdeationSnapshot, type IdeationState } from '@/shared/ipc/ideationApi';
import { migrateIdeation, repairConfirmedResearchLinks } from './ideationBoards';

export function useIdeation(root: string) {
  const [snapshot, setSnapshot] = useState<IdeationSnapshot | null>(null);
  const [state, setState] = useState<IdeationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadKey, reload] = useState(0);
  const stateRef = useRef<IdeationState | null>(null);
  const snapshotRef = useRef<IdeationSnapshot | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const dirty = state !== null && snapshot !== null && state !== snapshot.state;
  useEffect(() => {
    let live = true;
    setState(null); setSnapshot(null); setError(null);
    readIdeation(root).then(value => {
      if (!live) return;
      value = { ...value, state: migrateIdeation(value.state) };
      snapshotRef.current = value; stateRef.current = value.state; setSnapshot(value); setState(value.state);
    }).catch(e => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [root, loadKey]);
  const update = useCallback((change: (current: IdeationState) => IdeationState) => {
    if (!stateRef.current) return;
    let next = change(stateRef.current);
    if (sameIdeationData(next, stateRef.current)) return;
    if (!pending.current && snapshotRef.current && sameIdeationData(next, snapshotRef.current.state)) next = snapshotRef.current.state;
    stateRef.current = next; setState(next);
  }, []);
  const save = useCallback(async () => {
    if (pending.current) return pending.current;
    if (stateRef.current) { const repaired = repairConfirmedResearchLinks(stateRef.current); if (repaired !== stateRef.current) { stateRef.current = repaired; setState(repaired); } }
    const current = stateRef.current, previous = snapshotRef.current;
    if (!current || !previous) return false;
    if (sameIdeationData(current, previous.state)) { stateRef.current = previous.state; setState(previous.state); return true; }
    setSaving(true); setError(null);
    const operation = saveIdeation(root, previous.revision, current).then(value => {
      snapshotRef.current = value; setSnapshot(value);
      if (sameIdeationData(stateRef.current, current)) { stateRef.current = value.state; setState(value.state); }
      return stateRef.current === value.state;
    }).catch(e => { setError(String(e)); return false; }).finally(() => { setSaving(false); pending.current = null; });
    pending.current = operation;
    return operation;
  }, [root]);
  useEffect(() => {
    if (!dirty || saving || error) return;
    const timer = window.setTimeout(() => void save(), 800);
    return () => window.clearTimeout(timer);
  }, [dirty, saving, error, state, save]);
  useEffect(() => {
    const owner = `ideation:${root}`;
    setSegmentEditorDirty('ideation', owner, dirty);
    const unregister = registerSegmentEditorCloseHandler('ideation', owner, {
      isDirty: () => stateRef.current !== snapshotRef.current?.state,
      save,
      discard: () => { if (snapshotRef.current) { stateRef.current = snapshotRef.current.state; setState(snapshotRef.current.state); } }
    });
    return () => { unregister(); setSegmentEditorDirty('ideation', owner, false); };
  }, [root, dirty, save]);
  return { state, update, save, dirty, saving, error, retryLoad: () => reload(key => key + 1) };
}
