import type { Job } from '@/shared/ipc/workspaceApi';

export function isRunningJob(job: Job) {
  return job.status === 'queued' || job.status === 'processing';
}

export function isUnfinishedJob(job: Job) {
  return isRunningJob(job) || job.status === 'paused';
}

// Chrono emits 0/3/6/9 fractional digits. Compare instants, including sub-ms
// updates, rather than lexical timestamps (where .123Z sorts after .123001Z).
export function compareJobTimes(left: Job, right: Job) {
  const millis = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
  const fraction = (value: string) => Number((value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '').padEnd(9, '0').slice(0, 9));
  return millis(left.updated_at) - millis(right.updated_at) || fraction(left.updated_at) - fraction(right.updated_at);
}

/** Paused work is still unfinished; only terminal history may be trimmed. */
export function recentBackgroundJobs(jobs: Job[], historyLimit = 8): Job[] {
  const sorted = [...jobs].sort((left, right) => compareJobTimes(right, left));
  const unfinished = sorted.filter(isUnfinishedJob);
  return [...unfinished, ...sorted.filter(job => !isUnfinishedJob(job)).slice(0, historyLimit)];
}

/** Events already observed must win over a slower initial list snapshot. */
export function mergeBackgroundJobs(snapshot: Job[], observed: Job[]): Job[] {
  const byId = new Map(snapshot.map(job => [job.id, job]));
  for (const job of observed) {
    const previous = byId.get(job.id);
    if (!previous || compareJobTimes(job, previous) >= 0) byId.set(job.id, job);
  }
  return recentBackgroundJobs([...byId.values()], 24);
}
