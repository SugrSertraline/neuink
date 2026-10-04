import { listen } from '@tauri-apps/api/event';
import { useEffect, useMemo, useState } from 'react';

import { listJobs, type Job, type JobEvent, type JobScope } from '@/shared/ipc/workspaceApi';
import { compareJobTimes, isRunningJob, mergeBackgroundJobs, recentBackgroundJobs } from '@/shared/lib/backgroundJobs';

export function useWorkspaceJobs(root: string | null) {
  const [snapshot, setSnapshot] = useState<{ root: string | null; jobs: Job[] }>({ root: null, jobs: [] });
  const jobs = snapshot.root === root ? snapshot.jobs : [];

  useEffect(() => {
    let cancelled = false;
    setSnapshot({ root, jobs: [] });
    if (!root) return;
    let loadingSnapshot = true;
    // Temporary, untrimmed event journal prevents an old snapshot resurrecting
    // terminal tasks already evicted from the bounded UI history.
    const initialEvents = new Map<string, Job>();
    const unlistenPromise = listen<JobEvent>('neuink://job-event', (event) => {
      if (cancelled) {
        return;
      }
      const nextJob = event.payload.job;
      if (!jobMatchesRoot(nextJob, root)) {
        return;
      }
      if (loadingSnapshot) {
        const previous = initialEvents.get(nextJob.id);
        if (!previous || compareJobTimes(nextJob, previous) >= 0) initialEvents.set(nextJob.id, nextJob);
      }
      setSnapshot(current => ({ root, jobs: mergeBackgroundJobs(
        current.root === root ? current.jobs : [], [nextJob]
      ) }));
    });
    // Subscribe before requesting the snapshot so fast imports cannot disappear
    // between the initial read and listener registration.
    void unlistenPromise.catch(() => undefined).then(async () => {
      if (cancelled) return;
      try {
        const nextJobs = filterJobsForRoot(await listJobs(), root);
        const observed = [...initialEvents.values()];
        if (!cancelled) setSnapshot(current => ({ root, jobs: mergeBackgroundJobs(
          nextJobs, [...observed, ...(current.root === root ? current.jobs : [])]
        ) }));
      } catch { /* Keep observed task progress when the initial read fails. */ }
      finally { loadingSnapshot = false; initialEvents.clear(); }
    });

    return () => {
      cancelled = true;
      initialEvents.clear();
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [root]);

  const activeJobs = useMemo(
    () => jobs.filter(isRunningJob),
    [jobs]
  );
  const recentJobs = useMemo(
    () => recentBackgroundJobs(jobs),
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
  const scope: JobScope | null = job.scope;
  return scope?.root === root;
}
