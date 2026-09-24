import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { useToast } from '@/shared/hooks/useToast';
import { hasAnyUnsavedEdits } from './editSafety';
import { getAssistantBackgroundRuns } from '@/modules/assistant/components/assistantBackgroundRuns';

export function useUnsavedWindowCloseGuard() {
  const { notify } = useToast();
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasAnyUnsavedEdits() && getAssistantBackgroundRuns().length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) void getCurrentWindow().onCloseRequested((event) => {
      const dirty = hasAnyUnsavedEdits();
      const runs = getAssistantBackgroundRuns();
      if (!dirty && runs.length === 0) return;
      event.preventDefault();
      if (dirty) notify({ tone: 'default', title: '仍有未保存的修改', description: '请先保存文档笔记、片段笔记和批注，或在关闭页面时明确放弃修改，再退出应用。' });
      else notify({ tone: 'default', title: `仍有 ${runs.length} 个助手任务未结束`, description: '关闭应用会中断后台任务。请回到大模型对话处理待确认事项，或主动停止任务，待保存结束后再退出。' });
    }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; })
      .catch(() => { if (!disposed) notify({ tone: 'danger', title: '退出保护未能启用', description: '请在退出前手动保存所有修改，并等待或停止助手任务。' }); });
    return () => { disposed = true; unlisten?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [notify]);
}
