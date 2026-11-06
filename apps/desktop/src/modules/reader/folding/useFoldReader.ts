import { useCallback, useEffect, useRef, useState } from 'react';
import { readEntryFolds, type FoldRecord } from '@/shared/ipc/foldingApi';
import type { SourceSegment } from '@/shared/types/domain';
import { cancelFoldTask, cancelFoldSegments, foldTaskKey, foldTaskRunning, getFoldTaskSnapshot, pauseFoldTask, resumeFoldTask, startFoldTask, subscribeFoldTasks, type FoldTaskSnapshot } from './foldTasks';
import { buildFoldInputs } from './foldInput';
import { foldErrorMessage } from './foldErrors';

// 'off' is an internal suspension for sentence reading, not a selectable detail level.
export type FoldLevel = 'off' | 'full' | 'brief' | 'key' | 'takeaway' | 'topic';

export function useFoldReader(root: string | null, entryId: string, title: string,
  segments: SourceSegment[], ready: boolean, auto: boolean, visible: boolean, initialLevel: FoldLevel = 'full') {
  const [level, setLevel] = useState<FoldLevel>(initialLevel);
  // Apply the stored reading mode only on entry changes, not after a local level choice.
  const resetLevel = useRef(initialLevel);
  resetLevel.current = initialLevel;
  const [overrides, setOverrides] = useState<Record<string, FoldLevel>>({});
  const [records, setRecords] = useState<Record<string, FoldRecord>>({});
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [running, setRunning] = useState(false);
  const [task, setTask] = useState<FoldTaskSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const autoAttempt = useRef(false);
  const currentScope = useRef('');
  currentScope.current = root ? foldTaskKey(root, entryId) : '';
  const reload = useCallback(async () => {
    if (!root) return;
    const revision = ++generation.current;
    try {
      const next = await readEntryFolds(root, entryId);
      if (generation.current === revision) { setRecords(next); setLoadState('ready'); }
    } catch {
      if (generation.current === revision) { setLoadState('error'); setError('无法读取阅读详略，请重试。'); }
    }
  }, [root, entryId]);
  useEffect(() => {
    generation.current++; autoAttempt.current = false; setLevel(resetLevel.current); setOverrides({}); setRecords({});
    setError(null); setLoadState(root ? 'loading' : 'error'); setRunning(Boolean(root && foldTaskRunning(root, entryId)));
    const snapshot = root ? getFoldTaskSnapshot(root, entryId) : null;
    setTask(snapshot); setError(snapshot?.error ?? null);
    void reload();
    return () => { generation.current++; };
  }, [root, entryId, reload]);
  useEffect(() => {
    if (!root) return;
    return subscribeFoldTasks((key, recordsChanged) => {
      if (key !== foldTaskKey(root, entryId)) return;
      const active = foldTaskRunning(root, entryId); setRunning(active);
      const snapshot = getFoldTaskSnapshot(root, entryId); setTask(snapshot);
      if (snapshot?.error) setError(snapshot.error); else if (active) setError(null);
      if (recordsChanged) void reload();
    });
  }, [root, entryId, reload]);
  const start = useCallback((selected = segments, force = false) => {
    if (!root || !ready || loadState !== 'ready' || !selected.length || foldTaskRunning(root, entryId)) return false;
    const inputs = buildFoldInputs(selected);
    if (!inputs.batches.length) {
      setError(inputs.skipped.some(item => item.reason === 'too_short') ? '所选正文段落较短，暂不生成详略。' : '没有可生成详略的正文段落。');
      return false;
    }
    setError(null);
    const scope = foldTaskKey(root, entryId);
    void startFoldTask(root, entryId, title, selected, { force, documentSegments: segments }).catch(caught => {
      if (currentScope.current !== scope) return;
      if (caught instanceof Error && caught.name === 'AbortError') return;
      setError(foldErrorMessage(caught));
    });
    return true;
  }, [root, ready, loadState, segments, entryId, title]);
  useEffect(() => {
    if (!auto || !visible || !ready || loadState !== 'ready' || !segments.length || autoAttempt.current
        || !buildFoldInputs(segments).batches.length) return;
    autoAttempt.current = true; start();
  }, [auto, visible, ready, loadState, segments, start]);
  return {
    root, entryId, title, segments, ready,
    level, setLevel, overrides, records, loadState, running, task, error, reload, start,
    cancel: () => { if (root) cancelFoldTask(root, entryId); },
    pause: () => { if (root) pauseFoldTask(root, entryId); },
    resume: () => { if (root) resumeFoldTask(root, entryId); },
    cancelSegments: (uids: readonly string[]) => { if (root) cancelFoldSegments(root, entryId, uids); },
    setOverride: (uid: string, value: FoldLevel | 'inherit') => setOverrides(current => {
      const next = { ...current }; if (value === 'inherit') delete next[uid]; else next[uid] = value; return next;
    })
  };
}
export type FoldReader = ReturnType<typeof useFoldReader>;
