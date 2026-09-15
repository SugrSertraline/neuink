import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { useToast } from '@/shared/hooks/useToast';
import { hasAnyUnsavedEdits } from './editSafety';

export function useUnsavedWindowCloseGuard() {
  const { notify } = useToast();
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasAnyUnsavedEdits()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) void getCurrentWindow().onCloseRequested((event) => {
      if (!hasAnyUnsavedEdits()) return;
      event.preventDefault();
      notify({ tone: 'default', title: '仍有未保存的修改', description: '请先保存文档笔记、片段笔记和批注，或在关闭页面时明确放弃修改，再退出应用。' });
    }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; })
      .catch(() => { if (!disposed) notify({ tone: 'danger', title: '退出保护未能启用', description: '请在退出前手动保存所有修改。' }); });
    return () => { disposed = true; unlisten?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [notify]);
}
