import { useCallback, useEffect, useRef, useState } from 'react';
import { readTagReading, saveTagReading, type TagReadingMember, type TagReadingState } from '@/shared/ipc/tagReadingApi';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '../components/segmentEditorDirtyRegistry';
import { reconcileTagReading } from './tagReadingState';

export function useTagReadingWorkspace(root: string | null, tagId: string, refreshKey: string) {
  const [state, setState] = useState<TagReadingState | null>(null);
  const [members, setMembers] = useState<TagReadingMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<TagReadingState | null>(null);
  const pending = useRef<TagReadingState | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const generation = useRef(0);
  const live = useRef(false);
  const scope = `tag-reading:${tagId}`;
  const loadRef = useRef<(restore?: boolean) => Promise<void>>(async () => undefined);
  const reloadPending = useRef(false);

  const publish = useCallback((next: TagReadingState) => { current.current = next; setState(next); }, []);
  const load = useCallback(async (restore = false) => {
    if (pending.current || inFlight.current) { reloadPending.current = true; return; }
    if (!root) { setLoading(false); setError('请先打开资料库'); return; }
    const request = ++generation.current;
    setLoading(true);
    try {
      const response = await readTagReading(root, tagId);
      if (!live.current || request !== generation.current) return;
      setMembers(response.members);
      publish(reconcileTagReading(response.state, response.members, restore || !current.current));
      setError(null);
    } catch (caught) {
      if (live.current && request === generation.current) setError(message(caught));
    } finally {
      if (live.current && request === generation.current) setLoading(false);
    }
  }, [publish, root, tagId]);
  loadRef.current = load;

  const retry = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const snapshot = pending.current;
    if (!snapshot || !root) return Promise.resolve(!snapshot);
    setSaving(true);
    setError(null);
    const request = ++generation.current;
    const operation = saveTagReading(root, snapshot).then((saved) => {
      if (!live.current || request !== generation.current) return false;
      pending.current = null;
      publish(saved);
      setSegmentEditorDirty(scope, 'task-state', false);
      return true;
    }).catch((caught) => {
      if (live.current && request === generation.current) setError(message(caught));
      return false;
    }).finally(() => {
      inFlight.current = null;
      if (live.current && request === generation.current) {
        setSaving(false);
        if (!pending.current && reloadPending.current) {
          reloadPending.current = false;
          void loadRef.current();
        }
      }
    });
    inFlight.current = operation;
    return operation;
  }, [publish, root, scope]);

  const commit = useCallback((update: (value: TagReadingState) => TagReadingState) => {
    if (!current.current || pending.current || inFlight.current) return Promise.resolve(false);
    const next = update(current.current);
    if (next === current.current) return Promise.resolve(true);
    pending.current = next;
    setSegmentEditorDirty(scope, 'task-state', true);
    return retry();
  }, [retry, scope]);

  useEffect(() => {
    live.current = true;
    const unregister = registerSegmentEditorCloseHandler(scope, 'task-state', {
      save: retry,
      isDirty: () => Boolean(pending.current || inFlight.current),
      discard: () => {
        // A command already accepted by the backend is allowed to finish; only a
        // failed, unsaved task change can be discarded, never an on-disk revision.
        if (!inFlight.current) pending.current = null;
      }
    });
    return () => {
      live.current = false;
      generation.current++;
      unregister();
      setSegmentEditorDirty(scope, 'task-state', false);
    };
  }, [retry, scope]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  return { state, members, loading, saving, error, commit, retry,
    hasPending: Boolean(pending.current), reload: (restore = false) => load(restore) };
}

function message(caught: unknown) { return caught instanceof Error ? caught.message : String(caught); }
