import type { SourceSegment } from '@/shared/types/domain';
import type { JobProgress } from '@/shared/ipc/workspaceApi';
import { runLocalBackgroundJob, type LocalJobReporter } from '@/shared/lib/localBackgroundJobs';
import { generateEntryFolds, type FoldGenerationProgress } from './generateEntryFolds';
import { buildFoldInputs } from './foldInput';
import { FoldGenerationError, foldErrorMessage } from './foldErrors';
import { createFoldPauseGate, type FoldPauseGate } from './foldPauseGate';

type Task = { controller: AbortController; promise: Promise<void>; canceledSegments: Set<string>; pauseGate: FoldPauseGate; title: string; report?: LocalJobReporter };
export type FoldTaskSnapshot = {
  error?: string;
  status: 'running' | 'pausing' | 'paused' | 'stopping' | 'succeeded' | 'failed' | 'canceled';
  progress: FoldGenerationProgress;
  segments: readonly SourceSegment[];
  force: boolean;
};
const tasks = new Map<string, Task>();
const snapshots = new Map<string, FoldTaskSnapshot>();
const listeners = new Set<(key: string, recordsChanged: boolean) => void>();
export const foldTaskKey = (root: string, entryId: string) => JSON.stringify([root, entryId]);
export function subscribeFoldTasks(listener: (key: string, recordsChanged: boolean) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(key: string, recordsChanged = true) { for (const listener of listeners) { try { listener(key, recordsChanged); } catch { /* A view cannot stop the task. */ } } }
function jobProgress(progress: FoldGenerationProgress): JobProgress {
  const current = progress.completed + progress.failed + progress.canceledSegmentUids.length;
  return { current, total: progress.total, percent: progress.total ? Math.round(current / progress.total * 100) : 0 };
}
function reportTask(task: Task, snapshot: FoldTaskSnapshot) {
  const message = snapshot.status === 'paused' ? '阅读详略已暂停' : snapshot.status === 'pausing' ? '正在暂停阅读详略' :
    snapshot.status === 'stopping' ? '正在停止阅读详略' : '正在生成阅读详略';
  task.report?.(jobProgress(snapshot.progress), { status: snapshot.status === 'paused' ? 'paused' : 'processing', message: `${message}：${task.title}` });
}
export function notifyFoldUpdated(root: string, entryId: string) { publish(foldTaskKey(root, entryId)); }
export function foldTaskRunning(root: string, entryId: string) { return tasks.has(foldTaskKey(root, entryId)); }
export function getFoldTaskSnapshot(root: string, entryId: string) { return snapshots.get(foldTaskKey(root, entryId)) ?? null; }
export function cancelFoldTask(root: string, entryId: string) {
  const key = foldTaskKey(root, entryId);
  const task = tasks.get(key);
  if (!task || task.controller.signal.aborted) return;
  const snapshot = snapshots.get(key);
  if (snapshot) {
    const next: FoldTaskSnapshot = { ...snapshot, status: 'stopping' };
    snapshots.set(key, next); reportTask(task, next);
  }
  task.controller.abort();
  publish(key, false);
}

export function pauseFoldTask(root: string, entryId: string) {
  const key = foldTaskKey(root, entryId), task = tasks.get(key), snapshot = snapshots.get(key);
  if (!task || !snapshot || snapshot.status !== 'running') return;
  task.pauseGate.pause();
  const next: FoldTaskSnapshot = { ...snapshot, status: snapshot.progress.activeSegmentUids.length ? 'pausing' : 'paused' };
  snapshots.set(key, next); reportTask(task, next); publish(key, false);
}

export function resumeFoldTask(root: string, entryId: string) {
  const key = foldTaskKey(root, entryId), task = tasks.get(key), snapshot = snapshots.get(key);
  if (!task || !snapshot || !['pausing', 'paused'].includes(snapshot.status)) return;
  const next: FoldTaskSnapshot = { ...snapshot, status: 'running' };
  snapshots.set(key, next); task.pauseGate.resume(); reportTask(task, next); publish(key, false);
}

/** A pending item is skipped; an in-flight item's returned output is discarded before saving. */
export function cancelFoldSegments(root: string, entryId: string, segmentUids: readonly string[]) {
  const key = foldTaskKey(root, entryId);
  const task = tasks.get(key);
  const snapshot = snapshots.get(key);
  if (!task || !snapshot || !['running', 'pausing', 'paused'].includes(snapshot.status) || !snapshot.progress.total) return;
  const progress = snapshot.progress;
  const eligible = new Set(buildFoldInputs(snapshot.segments).batches.flat().map(segment => segment.segmentUid));
  const finished = new Set([...progress.completedSegmentUids, ...progress.failedSegmentUids, ...progress.cachedSegmentUids]);
  const saving = new Set(progress.savingSegmentUids ?? (progress.phase === 'saving' ? progress.activeSegmentUids : []));
  let changed = false;
  for (const uid of segmentUids) {
    if (eligible.has(uid) && !finished.has(uid) && !saving.has(uid) && !task.canceledSegments.has(uid)) {
      task.canceledSegments.add(uid); changed = true;
    }
  }
  if (!changed) return;
  const updatedProgress = { ...progress, canceledSegmentUids: [...task.canceledSegments] };
  const next = { ...snapshot, progress: updatedProgress };
  snapshots.set(key, next);
  task.pauseGate.wake();
  reportTask(task, next);
  publish(key, false);
}

/** One real operation per entry, shared by visible readers and retained across unmounts. */
export function startFoldTask(root: string, entryId: string, title: string, segments: readonly SourceSegment[],
  { onProgress, force = false, documentSegments = segments }: {
    onProgress?: (progress: FoldGenerationProgress) => void;
    force?: boolean;
    documentSegments?: readonly SourceSegment[];
  } = {}): Promise<void> {
  const key = foldTaskKey(root, entryId);
  const current = tasks.get(key);
  if (current) return current.promise;
  const controller = new AbortController();
  const task: Task = { controller, promise: Promise.resolve(), canceledSegments: new Set(), pauseGate: createFoldPauseGate(), title };
  tasks.set(key, task);
  snapshots.delete(key);
  snapshots.set(key, { status: 'running', segments: [...segments], force, progress: {
    phase: 'preparing', completed: 0, failed: 0, total: 0,
    activeSegmentUids: [], completedSegmentUids: [], failedSegmentUids: [], cachedSegmentUids: [], canceledSegmentUids: []
  } });
  while (snapshots.size > 24) {
    const oldest = [...snapshots.keys()].find(candidate => !tasks.has(candidate));
    if (!oldest) break;
    snapshots.delete(oldest);
  }
  task.promise = runLocalBackgroundJob({ kind: 'folding', scope: { kind: 'entry', root, entry_id: entryId },
    idPrefix: 'reading-fold', message: `正在生成阅读详略：${title}`, successMessage: `阅读详略任务已结束：${title}`,
    failureMessage: '阅读详略未完成，已有结果保留。' }, async report => {
    task.report = report;
    let lastCompleted = 0;
    const outcome = await generateEntryFolds({ root, entryId, segments, title, documentSegments, signal: controller.signal, force, canceledSegments: task.canceledSegments, pauseGate: task.pauseGate, onProgress: progress => {
      const snapshot = snapshots.get(key);
      if (snapshot) {
        const status = task.pauseGate.paused && snapshot.status !== 'stopping' ?
          (progress.activeSegmentUids.length ? 'pausing' : 'paused') : snapshot.status;
        const next: FoldTaskSnapshot = { ...snapshot, status, progress };
        snapshots.set(key, next); reportTask(task, next);
      }
      onProgress?.(progress);
      const recordsChanged = progress.completed > lastCompleted;
      lastCompleted = progress.completed;
      publish(key, recordsChanged);
    } });
    if (outcome.failedSegmentUids.length) throw new FoldGenerationError(outcome.failureCode ?? 'validation');
  }).then(() => {
    const snapshot = snapshots.get(key);
    if (snapshot) snapshots.set(key, { ...snapshot, status: 'succeeded' });
  }, error => {
    const snapshot = snapshots.get(key);
    const canceled = error instanceof Error && error.name === 'AbortError';
    if (snapshot) {
      const active = canceled ? [] : snapshot.progress.activeSegmentUids.filter(uid => !task.canceledSegments.has(uid));
      const failedSegmentUids = [...new Set([...snapshot.progress.failedSegmentUids, ...active])];
      snapshots.set(key, { ...snapshot, status: canceled ? 'canceled' : 'failed', error: canceled ? undefined : foldErrorMessage(error), progress: {
        ...snapshot.progress, activeSegmentUids: [], failedSegmentUids, failed: failedSegmentUids.length
      } });
    }
    throw error;
  }).finally(() => { if (tasks.get(key) === task) { tasks.delete(key); publish(key); } });
  publish(key, false);
  return task.promise;
}
