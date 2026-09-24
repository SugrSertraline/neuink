import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';

/** Serializes writes, retains failed drafts, and isolates late results after a library switch. */
export function useSettingsAutosave<T>({ value, savedValue, equal, save, onSaved, enabled = true, scope = '', closeScope, delay = 500 }: {
  value: T; savedValue: T; equal: (a: T, b: T) => boolean;
  save: (value: T) => Promise<unknown> | void; onSaved: (value: T) => void;
  enabled?: boolean; scope?: string; closeScope?: string; delay?: number;
}) {
  const owner = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const failedValue = useRef<{ value: T } | null>(null);
  const generation = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const persisted = useRef(savedValue);
  const previousSavedProp = useRef(savedValue);
  const latest = useRef({ value, enabled, save, onSaved, equal });
  latest.current = { value, enabled, save, onSaved, equal };
  if (previousSavedProp.current !== savedValue) {
    persisted.current = savedValue;
    previousSavedProp.current = savedValue;
  }
  const isDirty = useCallback(() => latest.current.enabled &&
    (pending.current !== null || !latest.current.equal(latest.current.value, persisted.current)), []);
  useLayoutEffect(() => {
    generation.current += 1;
    persisted.current = savedValue;
    pending.current = null;
    setSaving(false);
    setError(null);
    failedValue.current = null;
    return () => { generation.current += 1; window.clearTimeout(timer.current); };
  }, [scope]);

  const write = useCallback((snapshot: T) => {
      const currentGeneration = generation.current;
      const saveSnapshot = latest.current.save;
      setSaving(true);
      setError(null);
      const request = Promise.resolve().then(() => saveSnapshot(snapshot)).then(() => {
        if (generation.current !== currentGeneration) return false;
        persisted.current = snapshot;
        failedValue.current = null;
        latest.current.onSaved(snapshot);
        return true;
      }).catch((caught: unknown) => {
        if (generation.current === currentGeneration) {
          failedValue.current = { value: snapshot };
          setError(caught instanceof Error ? caught.message : String(caught));
        }
        return false;
      }).finally(() => {
        if (generation.current === currentGeneration) {
          pending.current = null;
          setSaving(false);
        }
      });
      pending.current = request;
      return request;
  }, []);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const currentGeneration = generation.current;
    if (pending.current && !await pending.current) return false;
    if (currentGeneration !== generation.current) return false;
    if (!latest.current.enabled) return true;
    if (!latest.current.equal(latest.current.value, persisted.current) && !await write(latest.current.value)) return false;
    return currentGeneration === generation.current && !isDirty();
  }, [isDirty, write]);

  useEffect(() => {
    if (!enabled || pending.current) return;
    if (equal(value, persisted.current)) {
      failedValue.current = null;
      setError(null);
      return;
    }
    if (failedValue.current && equal(value, failedValue.current.value)) return;
    timer.current = window.setTimeout(() => { if (!pending.current) void write(latest.current.value); }, delay);
    return () => window.clearTimeout(timer.current);
  }, [value, savedValue, saving, enabled, scope, delay, retryKey, write]);

  const dirty = enabled && !equal(value, savedValue);
  useEffect(() => {
    if (!closeScope) return;
    const unregister = registerSegmentEditorCloseHandler(closeScope, owner, {
      save: flush,
      isDirty,
      discard: () => { window.clearTimeout(timer.current); generation.current += 1; }
    });
    return () => { unregister(); setSegmentEditorDirty(closeScope, owner, false); };
  }, [closeScope, owner, flush, isDirty]);
  useEffect(() => {
    if (closeScope) setSegmentEditorDirty(closeScope, owner, dirty || saving);
  }, [closeScope, owner, dirty, saving]);
  return { saving, error, dirty, flush, retry: () => { failedValue.current = null; setError(null); setRetryKey(key => key + 1); } };
}
