import type { Job, JobProgress, JobScope } from '@/shared/ipc/workspaceApi';
import { assistantErrorDiagnostic } from './assistantDebug';
import { recentBackgroundJobs } from './backgroundJobs';

type LocalJobOptions = {
  kind: Job['kind'];
  scope: JobScope | null;
  idPrefix?: string;
  message: string;
  successMessage: string;
  /** Trusted UI copy only; remote error bodies must not be used here. */
  failureMessage: string;
};

export type LocalJobReporter = (progress: JobProgress, update?: { status?: 'processing' | 'paused'; message?: string }) => void;

// A window-local projection, not another executor or persistent task queue.
// Keeping it outside a reader component lets an in-flight selection outlive its toolbar.
let jobs: Job[] = [];
const listeners = new Set<() => void>();

export const getLocalBackgroundJobs = (): Job[] => jobs;

export function subscribeLocalBackgroundJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

let notificationTimer: ReturnType<typeof setTimeout> | undefined;
function notifyListeners() {
  if (notificationTimer !== undefined) clearTimeout(notificationTimer);
  notificationTimer = undefined;
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* A display subscriber cannot cancel the real operation. */ }
  }
}
export function publishLocalBackgroundJob(job: Job): void {
  const previous = jobs.find(current => current.id === job.id);
  jobs = recentBackgroundJobs([job, ...jobs.filter(current => current.id !== job.id)], 24);
  // Keep true state immediately readable, while limiting progress-only UI updates to 10 Hz.
  if (!previous || previous.status !== job.status || !['processing', 'queued'].includes(job.status)) {
    notifyListeners();
  } else if (notificationTimer === undefined) {
    notificationTimer = setTimeout(notifyListeners, 100);
  }
}

export async function runLocalBackgroundJob<T>(options: LocalJobOptions, execute: (report: LocalJobReporter) => Promise<T>): Promise<T> {
  const now = new Date().toISOString();
  let job: Job = {
    id: `${options.idPrefix ?? 'local-task'}:${crypto.randomUUID()}`,
    kind: options.kind,
    scope: options.scope ? { ...options.scope } : null,
    status: 'processing',
    message: options.message,
    error: null,
    progress: { current: 0, total: 0, percent: 0 },
    created_at: now,
    updated_at: now
  };
  let finished = false;
  publishLocalBackgroundJob(job);
  try {
    const result = await execute((progress, update) => {
      if (finished) return;
      job = { ...job, ...update, progress, updated_at: new Date().toISOString() };
      publishLocalBackgroundJob(job);
    });
    job = { ...job, status: 'succeeded', message: options.successMessage };
    return result;
  } catch (error) {
    // Only an allowlisted category/status survives in the task registry. The
    // owning UI still receives its original exception and applies its own policy.
    const duplicateCanceled = error instanceof Error && error.name === 'PdfDuplicateCancelledError';
    const canceled = (error instanceof DOMException && error.name === 'AbortError') || duplicateCanceled;
    job = { ...job, status: canceled ? 'canceled' : 'failed', message: duplicateCanceled ? '已取消添加重复的 PDF' : canceled ? '操作已停止，已完成的内容保留' : options.failureMessage, error: canceled ? null : assistantErrorDiagnostic(error) };
    throw error;
  } finally {
    finished = true;
    publishLocalBackgroundJob({ ...job, updated_at: new Date().toISOString() });
  }
}
