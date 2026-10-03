import type { Job, JobScope } from '@/shared/ipc/workspaceApi';
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

// A window-local projection, not another executor or persistent task queue.
// Keeping it outside a reader component lets an in-flight selection outlive its toolbar.
let jobs: Job[] = [];
const listeners = new Set<() => void>();

export const getLocalBackgroundJobs = (): Job[] => jobs;

export function subscribeLocalBackgroundJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(job: Job): void {
  jobs = recentBackgroundJobs([job, ...jobs.filter(current => current.id !== job.id)], 24);
  for (const listener of [...listeners]) {
    // A disposed/broken display subscriber must never cancel the real operation.
    try { listener(); } catch { /* Task state is available to the next subscriber. */ }
  }
}

export async function runLocalBackgroundJob<T>(options: LocalJobOptions, execute: () => Promise<T>): Promise<T> {
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
  publish(job);
  try {
    const result = await execute();
    job = { ...job, status: 'succeeded', message: options.successMessage };
    return result;
  } catch (error) {
    // Only an allowlisted category/status survives in the task registry. The
    // owning UI still receives its original exception and applies its own policy.
    job = { ...job, status: 'failed', message: options.failureMessage, error: assistantErrorDiagnostic(error) };
    throw error;
  } finally {
    publish({ ...job, updated_at: new Date().toISOString() });
  }
}
