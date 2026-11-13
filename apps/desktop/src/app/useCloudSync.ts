import { createElement, useContext, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { listen } from '@tauri-apps/api/event';
import { cloudAccount, type CloudSyncState } from '@/shared/ipc/cloudAccountApi';
import { getLocalBackgroundJobs, publishLocalBackgroundJob } from '@/shared/lib/localBackgroundJobs';
import { ToastContext } from '@/shared/hooks/useToast';
import { cloudSyncProgress } from './cloudSyncProgress';

export function useCloudSync(root: string | null, ready: boolean, onOpenIssues?: (root: string) => void) {
  const toast = useContext(ToastContext);
  const openIssues = useRef(onOpenIssues); openIssues.current = onOpenIssues;
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let closed = false;
    let stop: (() => void) | undefined;
    const errors = new Map<string, string>();
    void listen<{ root: string; automatic: boolean; task: CloudSyncState['task'] }>('cloud-sync-task', event => {
      if (closed) return;
      const { root: target, task } = event.payload;
      const id = 'cloud-task:' + task.id;
      const previous = getLocalBackgroundJobs().find(job => job.id === id);
      const result = task.result;
      const incomplete = !!result?.uploads_blocked || !!task.error || !!result?.conflicts || !!result?.failures.length;
      const problems = [task.error,
        result?.uploads_blocked ? '配额不足，自动上传已暂停，云端下载继续。' : null,
        result?.conflicts ? `${result.conflicts} 项版本冲突，请在同步问题区查看及处理冲突。` : null,
        ...(result?.failures ?? []).map(([object, reason]) => `${object} · ${reason}`),
      ].filter(Boolean).join('\n');
      const now = new Date().toISOString();
      const display = cloudSyncProgress(task.progress);
      publishLocalBackgroundJob({
        id, kind: 'sync', scope: { kind: 'workspace', root: target },
        status: task.running ? 'processing' : task.cancelled ? 'canceled' : incomplete ? 'failed' : 'succeeded',
        message: task.running ? display.message : task.cancelled ? '本次同步已取消'
          : incomplete ? problems : result?.pending ? '本轮已结束，仍有 ' + result.pending + ' 项等待后续同步' : '同步完成，发布 ' + (result?.published ?? 0) + '，落盘 ' + (result?.applied ?? 0),
        error: null, progress: display.progress,
        created_at: previous?.created_at ?? now, updated_at: now,
      });
      if (!task.running && incomplete) {
        const message = problems;
        if (errors.get(target) !== message) toast?.notify({ title: '同步需要处理', description: message, tone: 'danger',
          navigation: { kind: 'cloud-sync', root: target },
          action: onOpenIssues ? createElement(Button, { size: 'sm', variant: 'outline', onClick: () => openIssues.current?.(target) }, '立即处理') : undefined,
        });
        errors.set(target, message);
      } else if (!task.running && !task.cancelled) {
        errors.delete(target);
      }
    }).then(unlisten => { if (closed) unlisten(); else stop = unlisten; })
      .catch(() => { if (!closed) toast?.notify({ title: '同步状态通知不可用，请在账户设置查看', tone: 'danger' }); });
    return () => { closed = true; stop?.(); };
  }, [toast]);

  useEffect(() => {
    if (!root || !ready || !('__TAURI_INTERNALS__' in window)) return;
    let closed = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (closed || running) return;
      running = true;
      let delay = 1000;
      try { await cloudAccount({ action: 'sync_auto', root: root! }); }
      catch { delay = 60000; }
      finally {
        running = false;
        if (!closed) timer = setTimeout(() => void tick(), delay);
      }
    }
    const online = () => {
      void cloudAccount({ action: 'sync_wake', root }).then(() => {
        if (!closed) { clearTimeout(timer); void tick(); }
      }).catch(() => undefined);
    };
    window.addEventListener('online', online);
    void tick();
    return () => { closed = true; clearTimeout(timer); window.removeEventListener('online', online); };
  }, [root, ready]);
}
