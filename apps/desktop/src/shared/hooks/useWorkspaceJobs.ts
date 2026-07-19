import { listen } from '@tauri-apps/api/event';
import { useEffect, useMemo, useState } from 'react';

import { listJobs, type Job, type JobEvent } from '@/shared/ipc/workspaceApi';

type JobScopeEntry = {
  root?: string;
};

export function useWorkspaceJobs(root: string | null) {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!root) {
      setJobs([]);
      return;
    }

    void listJobs()
      .then((nextJobs) => {
        if (!cancelled) {
          setJobs(filterJobsForRoot(nextJobs, root));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setJobs([]);
        }
      });

    const unlistenPromise = listen<JobEvent>('neuink://job-event', (event) => {
      if (cancelled) {
        return;
      }
      const nextJob = event.payload.job;
      if (!jobMatchesRoot(nextJob, root)) {
        return;
      }
      setJobs((current) => upsertJob(current, nextJob));
    });

    return () => {
      cancelled = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [root]);

  const activeJobs = useMemo(
    () => jobs.filter((job) => job.status === 'queued' || job.status === 'processing'),
    [jobs]
  );
  const recentJobs = useMemo(
    () =>
      [...jobs]
        .sort(sortJobsByUpdatedAt)
        .slice(0, 8),
    [jobs]
  );

  return {
    activeJobs,
    jobs: recentJobs
  };
}

function filterJobsForRoot(jobs: Job[], root: string) {
  return jobs.filter((job) => jobMatchesRoot(job, root));
}

function jobMatchesRoot(job: Job, root: string) {
  const scope = (job.scope ?? null) as JobScopeEntry | null;
  return scope?.root === root;
}

function upsertJob(currentJobs: Job[], nextJob: Job) {
  const filtered = currentJobs.filter((job) => job.id !== nextJob.id);
  return [...filtered, nextJob].sort(sortJobsByUpdatedAt).slice(0, 24);
}

function sortJobsByUpdatedAt(left: Job, right: Job) {
  return (
    new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  );
}
