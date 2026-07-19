import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  pauseEntryTranslation,
  listJobs,
  readEntryTranslation,
  runEntryTranslation,
  type EntryTranslation,
  type Job,
  type JobEvent
} from '@/shared/ipc/workspaceApi';

export type TranslationRunStrategy = 'restart' | 'resume';
export type TranslationStartOptions = {
  force?: boolean;
  segmentUids?: string[];
};

type JobScopeEntry = {
  entry_id?: string;
  entryId?: string;
  root?: string;
};

function isTranslationJobForEntry(job: Job, workspaceRoot: string, entryId: string) {
  if (job.kind !== 'translation') {
    return false;
  }
  const scope = (job.scope ?? null) as JobScopeEntry | null;
  if (!scope) {
    return false;
  }
  return scope.root === workspaceRoot && (scope.entry_id === entryId || scope.entryId === entryId);
}

function translationFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const candidate = (payload as { translation?: EntryTranslation | null }).translation;
  return candidate ?? null;
}

function isTerminalJobStatus(status: Job['status']) {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

export function useEntryTranslationTask({
  entryId,
  workspaceRoot
}: {
  entryId: string;
  workspaceRoot: string | null;
}) {
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [translation, setTranslation] = useState<EntryTranslation | null>(null);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationDetail, setTranslationDetail] = useState<string | null>(null);
  const [translationMessage, setTranslationMessage] = useState<string | null>(null);
  const activeJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeJobIdRef.current = null;
    setActiveJob(null);
    setTranslation(null);
    setTranslationBusy(false);
    setTranslationDetail(null);
    setTranslationMessage(null);
  }, [entryId]);

  useEffect(() => {
    if (!workspaceRoot) {
      setTranslation(null);
      setTranslationBusy(false);
      return;
    }

    let cancelled = false;
    void readEntryTranslation(workspaceRoot, entryId)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setTranslation(response.translation);
        void listJobs()
          .then((jobs) => {
            if (cancelled) return;
            const runningJob = jobs.find((job) =>
              isTranslationJobForEntry(job, workspaceRoot, entryId) && !isTerminalJobStatus(job.status)
            );
            if (runningJob) {
              activeJobIdRef.current = runningJob.id;
              setActiveJob(runningJob);
              setTranslationMessage(runningJob.message ?? null);
            }
            setTranslationBusy(Boolean(runningJob));
          })
          .catch(() => {
            if (!cancelled) setTranslationBusy(false);
          });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setTranslation(null);
        setTranslationBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entryId, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) {
      return;
    }

    let disposed = false;
    const unlistenPromise = listen<JobEvent>('neuink://job-event', (event) => {
      if (disposed) {
        return;
      }
      const nextEvent = event.payload;
      if (!isTranslationJobForEntry(nextEvent.job, workspaceRoot, entryId)) {
        return;
      }

      activeJobIdRef.current = nextEvent.job.id;
      setActiveJob(nextEvent.job);
      setTranslationMessage(nextEvent.job.message ?? null);

      const payloadTranslation = translationFromPayload(nextEvent.payload);
      if (payloadTranslation) {
        setTranslation(payloadTranslation);
        setTranslationDetail(payloadTranslation.error ?? null);
      } else if (nextEvent.job.error) {
        setTranslationDetail(nextEvent.job.error);
      }

      if (isTerminalJobStatus(nextEvent.job.status)) {
        setTranslationBusy(false);
        if (!payloadTranslation) {
          void readEntryTranslation(workspaceRoot, entryId)
            .then((response) => {
              if (!disposed) {
                setTranslation(response.translation);
                setTranslationDetail(response.translation?.error ?? null);
              }
            })
            .catch(() => undefined);
        }
        return;
      }

      setTranslationBusy(true);
    });

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [entryId, workspaceRoot]);

  const startTranslation = useCallback(
    async (
      strategy: TranslationRunStrategy,
      options: TranslationStartOptions = {},
    ) => {
      if (!workspaceRoot) {
        throw new Error('Workspace not available');
      }

      setTranslationBusy(true);
      setTranslationDetail(null);
      setTranslationMessage(
        options.segmentUids
          ? `正在翻译选中的 ${options.segmentUids.length} 个 Block`
          : strategy === 'resume'
            ? '继续翻译全文'
            : '开始翻译全文',
      );
      try {
        const response = await runEntryTranslation(workspaceRoot, entryId, {
          force: options.force,
          segmentUids: options.segmentUids,
          sourceLanguage: 'en',
          strategy,
          targetLanguage: 'zh-CN',
        });
        activeJobIdRef.current = response.job.id;
        setActiveJob(response.job);
        setTranslation(response.translation);
        return response;
      } catch (error) {
        setTranslationBusy(false);
        throw error;
      }
    },
    [entryId, workspaceRoot]
  );

  const pauseTranslation = useCallback(async () => {
    const jobId = activeJobIdRef.current;
    if (!jobId) {
      throw new Error('No active translation job');
    }

    setTranslationMessage('正在暂停全文翻译');
    const job = await pauseEntryTranslation(jobId);
    if (job) {
      setActiveJob(job);
    }
    return job;
  }, []);

  const reloadTranslation = useCallback(async () => {
    if (!workspaceRoot) return null;
    const response = await readEntryTranslation(workspaceRoot, entryId);
    setTranslation(response.translation);
    return response.translation;
  }, [entryId, workspaceRoot]);

  const currentJobKey = useMemo(() => {
    if (!activeJob) {
      return null;
    }
    return `${activeJob.id}:${activeJob.status}`;
  }, [activeJob]);

  return {
    activeJob,
    currentJobKey,
    pauseTranslation,
    startTranslation,
    reloadTranslation,
    translation,
    translationBusy,
    translationDetail,
    translationMessage
  };
}
