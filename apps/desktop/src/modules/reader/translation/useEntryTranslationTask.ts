import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  pauseEntryTranslation,
  cancelTranslationTask,
  resumeEntryTranslation,
  listJobs,
  readEntryTranslation,
  runEntryTranslation,
  type EntryTranslation,
  type Job,
  type JobEvent,
  type JobScope
} from '@/shared/ipc/workspaceApi';

export type TranslationRunStrategy = 'restart' | 'resume';
export type TranslationStopAction = 'pause' | 'cancel';
export type TranslationTaskAction = TranslationStopAction | 'resume';
export type TranslationStartOptions = {
  force?: boolean;
  segmentUids?: string[];
};

function isTranslationJobForEntry(job: Job, workspaceRoot: string, entryId: string) {
  if (job.kind !== 'translation') {
    return false;
  }
  const scope: JobScope | null = job.scope;
  return scope?.kind === 'entry' && scope.root === workspaceRoot && scope.entry_id === entryId;
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

const RECEIVED_CHARS_PATTERN = /已接收\s*(\d+)\s*字/;

// Single-segment translation has no job event. Share its refreshed snapshot
// with other mounted PDF/reflow views of the same entry in this window.
const translationRefreshListeners = new Set<(root: string, entryId: string, value: EntryTranslation | null) => void>();

/** Keep the running action stable while retaining the latest stream receipt count. */
export function normalizeTranslationJobMessage(
  status: Job['status'],
  message: string | null | undefined,
  previous: string | null = null
) {
  if (status !== 'processing' && status !== 'queued') {
    return message ?? null;
  }

  const received = message?.match(RECEIVED_CHARS_PATTERN)?.[1];
  if (received) {
    const previousReceived = previous?.match(RECEIVED_CHARS_PATTERN)?.[1];
    if (previousReceived && Number(previousReceived) > Number(received)) {
      return previous;
    }
    return `正在翻译 · 已接收 ${received} 字`;
  }

  return previous?.match(RECEIVED_CHARS_PATTERN) ? previous : '正在翻译';
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
  const jobRef = useRef<Job | null>(null);
  const revisionRef = useRef(0);
  const scopeRef = useRef<object>({});
  const stopRef = useRef<TranslationTaskAction | null>(null);
  const [stopPending, setStopPending] = useState<TranslationTaskAction | null>(null);

  useEffect(() => {
    const receive = (root: string, id: string, value: EntryTranslation | null) => {
      if (root !== workspaceRoot || id !== entryId) return;
      revisionRef.current += 1;
      setTranslation(value);
      setTranslationDetail(value?.error ?? null);
    };
    translationRefreshListeners.add(receive);
    return () => { translationRefreshListeners.delete(receive); };
  }, [entryId, workspaceRoot]);

  const acceptJob = useCallback((job: Job) => {
    const previous = jobRef.current;
    if (previous && previous.id === job.id && (
      (isTerminalJobStatus(previous.status) && !isTerminalJobStatus(job.status)) ||
      (previous.status === 'paused' && (job.status === 'processing' || job.status === 'queued') && job.updated_at <= previous.updated_at) ||
      previous.updated_at > job.updated_at
    )) return false;
    if (previous && previous.id !== job.id && previous.created_at > job.created_at) return false;
    revisionRef.current += 1;
    jobRef.current = job;
    activeJobIdRef.current = job.id;
    setActiveJob(job);
    setTranslationBusy(job.status === 'queued' || job.status === 'processing');
    if (isTerminalJobStatus(job.status) || job.status === 'paused' || (stopRef.current === 'resume' && job.status === 'processing')) {
      stopRef.current = null;
      setStopPending(null);
    }
    setTranslationMessage((previousMessage) => normalizeTranslationJobMessage(job.status, job.message, previousMessage));
    return true;
  }, []);

  useEffect(() => {
    activeJobIdRef.current = null;
    jobRef.current = null;
    revisionRef.current += 1;
    scopeRef.current = {};
    stopRef.current = null;
    setStopPending(null);
    setActiveJob(null);
    setTranslation(null);
    setTranslationBusy(false);
    setTranslationDetail(null);
    setTranslationMessage(null);
    return () => { scopeRef.current = {}; };
  }, [entryId, workspaceRoot]);

  useEffect(() => {
    if (!workspaceRoot) {
      setTranslation(null);
      setTranslationBusy(false);
      return;
    }

    let cancelled = false;
    const initialRevision = revisionRef.current;
    void readEntryTranslation(workspaceRoot, entryId)
      .then((response) => {
        if (cancelled || revisionRef.current !== initialRevision) {
          return;
        }
        setTranslation(response.translation);
        void listJobs()
          .then((jobs) => {
            if (cancelled || revisionRef.current !== initialRevision) return;
            const runningJob = jobs.find((job) =>
              isTranslationJobForEntry(job, workspaceRoot, entryId) && !isTerminalJobStatus(job.status)
            );
            if (runningJob) {
              acceptJob(runningJob);
            }
            setTranslationBusy(runningJob?.status === 'queued' || runningJob?.status === 'processing');
          })
          .catch(() => {
            if (!cancelled && revisionRef.current === initialRevision) setTranslationBusy(false);
          });
      })
      .catch(() => {
        if (cancelled || revisionRef.current !== initialRevision) {
          return;
        }
        setTranslation(null);
        setTranslationBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [acceptJob, entryId, workspaceRoot]);

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

      if (!acceptJob(nextEvent.job)) return;
      const revision = revisionRef.current;

      const payloadTranslation = translationFromPayload(nextEvent.payload);
      if (payloadTranslation) {
        setTranslation(payloadTranslation);
        setTranslationDetail(payloadTranslation.error ?? null);
      } else if (nextEvent.job.error) {
        setTranslationDetail(nextEvent.job.error);
      }

      if (isTerminalJobStatus(nextEvent.job.status) || nextEvent.job.status === 'paused') {
        setTranslationBusy(false);
        if (!payloadTranslation || nextEvent.job.status === 'succeeded') {
          void readEntryTranslation(workspaceRoot, entryId)
            .then((response) => {
              if (!disposed && revisionRef.current === revision) {
                if (response.translation) {
                  setTranslation(response.translation);
                  setTranslationDetail(response.translation.error ?? null);
                }
              }
            })
            .catch(() => {
              if (!disposed && revisionRef.current === revision) setTranslationDetail('译文已完成，但刷新失败；请重新打开此条目以重试读取。');
            });
        }
        return;
      }

      setTranslationBusy(true);
    }).catch(() => {
      if (!disposed) setTranslationDetail('无法接收翻译任务状态，请重新打开此条目。');
      return () => undefined;
    });

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    };
  }, [acceptJob, entryId, workspaceRoot]);

  const startTranslation = useCallback(
    async (
      strategy: TranslationRunStrategy,
      options: TranslationStartOptions = {},
    ) => {
      if (!workspaceRoot) {
        throw new Error('Workspace not available');
      }

      const scope = scopeRef.current;
      const revision = ++revisionRef.current;
      stopRef.current = null;
      setStopPending(null);
      setTranslationBusy(true);
      setTranslationDetail(null);
      setTranslationMessage('正在翻译');
      try {
        const response = await runEntryTranslation(workspaceRoot, entryId, {
          force: options.force,
          segmentUids: options.segmentUids,
          sourceLanguage: 'en',
          strategy,
          targetLanguage: 'zh-CN',
        });
        if (scopeRef.current === scope && revisionRef.current === revision && acceptJob(response.job)) {
          setTranslation(response.translation);
        }
        return response;
      } catch (error) {
        if (scopeRef.current === scope && revisionRef.current === revision) setTranslationBusy(false);
        throw error;
      }
    },
    [acceptJob, entryId, workspaceRoot]
  );

  const stopTranslation = useCallback(async (action: TranslationStopAction) => {
    const jobId = translation?.task?.job_id ?? activeJobIdRef.current;
    if (stopRef.current) return null;
    if (!jobId) {
      throw new Error('No active translation job');
    }

    const scope = scopeRef.current;
    stopRef.current = action;
    setStopPending(action);
    try {
      if (!workspaceRoot) throw new Error('Workspace not available');
      const response = action === 'cancel' ? await cancelTranslationTask(workspaceRoot, entryId, jobId) : null;
      const job = action === 'pause' ? await pauseEntryTranslation(jobId) : response?.job;
      if (!job) throw new Error('翻译任务不存在，请重新打开翻译任务。');
      // A queued response must never overwrite a newer terminal event.
      if (scopeRef.current === scope && (activeJobIdRef.current === jobId || !activeJobIdRef.current) && (isTerminalJobStatus(job.status) || job.status === 'paused') && acceptJob(job)) {
        const revision = revisionRef.current;
        const saved = response ?? await readEntryTranslation(workspaceRoot, entryId);
        if (scopeRef.current === scope && revisionRef.current === revision) {
          setTranslation(saved.translation);
          setTranslationDetail(saved.translation?.error ?? null);
        }
      }
      return job;
    } catch (error) {
      if (scopeRef.current === scope && activeJobIdRef.current === jobId) {
        stopRef.current = null;
        setStopPending(null);
      }
      throw error;
    }
  }, [acceptJob, entryId, workspaceRoot, translation?.task?.job_id]);
  const pauseTranslation = useCallback(() => stopTranslation('pause'), [stopTranslation]);
  const cancelTranslation = useCallback(() => stopTranslation('cancel'), [stopTranslation]);

  const resumeTranslation = useCallback(async () => {
    if (stopRef.current) return;
    const jobId = translation?.task?.job_id;
    if (!workspaceRoot || !jobId || translation?.status !== 'paused') throw new Error('没有可继续的翻译任务。');
    const scope = scopeRef.current;
    const revision = revisionRef.current;
    stopRef.current = 'resume';
    setStopPending('resume');
    try {
      const response = await resumeEntryTranslation(workspaceRoot, entryId, jobId);
      if (scopeRef.current === scope && revisionRef.current === revision && acceptJob(response.job)) setTranslation(response.translation);
      return response;
    } finally {
      if (scopeRef.current === scope && stopRef.current === 'resume') {
        stopRef.current = null;
        setStopPending(null);
      }
    }
  }, [acceptJob, entryId, workspaceRoot, translation]);

  const reloadTranslation = useCallback(async () => {
    if (!workspaceRoot) return null;
    const scope = scopeRef.current;
    const revision = revisionRef.current;
    const response = await readEntryTranslation(workspaceRoot, entryId);
    if (scopeRef.current === scope && revisionRef.current === revision) {
      translationRefreshListeners.forEach(receive => receive(workspaceRoot, entryId, response.translation));
    }
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
    cancelTranslation,
    resumeTranslation,
    translationPaused: !translationBusy && translation?.status === 'paused' && Boolean(translation.task),
    stopPending,
    startTranslation,
    reloadTranslation,
    translation,
    translationBusy,
    translationDetail,
    translationMessage: stopPending ? (stopPending === 'resume' ? '正在继续翻译…' : stopPending === 'pause' ? '正在暂停翻译…' : '正在取消翻译…') : translationMessage
  };
}
