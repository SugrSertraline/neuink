import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { useToast } from '@/shared/hooks/useToast';
import { hasAnyUnsavedEdits } from './editSafety';
import { getAssistantBackgroundRuns, getAssistantMessageQueues, resumeAssistantBackgroundWorkAfterFailedClose, stopAssistantBackgroundWorkForClose } from '@/modules/assistant/components/assistantBackgroundRuns';

export function useUnsavedWindowCloseGuard() {
  const { notify } = useToast();
  useEffect(() => {
    let closing = false;
    let readyToClose = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (readyToClose && !hasAnyUnsavedEdits()) return;
      if (!hasAnyUnsavedEdits() && getAssistantBackgroundRuns().length === 0 && getAssistantMessageQueues().length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) void getCurrentWindow().onCloseRequested((event) => {
      if (readyToClose) return;
      const dirty = hasAnyUnsavedEdits();
      const runs = getAssistantBackgroundRuns();
      const queuedCount = getAssistantMessageQueues().reduce((count, queue) => count + queue.items.length, 0);
      if (!dirty && runs.length === 0 && queuedCount === 0) return;
      event.preventDefault();
      if (dirty) {
        notify({ tone: 'default', title: '仍有未保存的修改', description: '请先保存文档笔记、片段笔记和批注，或在关闭页面时明确放弃修改，再退出应用。' });
        return;
      }
      if (closing) return;
      closing = true;
      notify({ tone: 'default', title: '正在结束任务', description: `正在停止 ${runs.length} 个助手任务并清除 ${queuedCount} 条待发送消息，然后关闭应用。` });
      void stopAssistantBackgroundWorkForClose().then(async () => {
        if (disposed) return;
        if (hasAnyUnsavedEdits()) {
          closing = false;
          resumeAssistantBackgroundWorkAfterFailedClose();
          notify({ tone: 'default', title: '仍有未保存的修改', description: '请先保存修改，再关闭应用。' });
          return;
        }
        readyToClose = true;
        await getCurrentWindow().close();
      }).catch(() => {
        closing = false;
        readyToClose = false;
        resumeAssistantBackgroundWorkAfterFailedClose();
        if (!disposed) notify({ tone: 'danger', title: '关闭失败', description: '任务已停止，请再次关闭应用。' });
      });
    }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; })
      .catch(() => { if (!disposed) notify({ tone: 'danger', title: '退出保护未能启用', description: '请在退出前手动保存所有修改，并等待或停止助手任务。' }); });
    return () => { disposed = true; unlisten?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [notify]);
}
