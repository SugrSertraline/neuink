import { useEffect, useState } from 'react';
import { cloudAccount, onCloudLibraryChanged } from '@/shared/ipc/cloudAccountApi';
export type EntryCloudStatus = 'source' | 'local' | 'pending' | 'synced' | 'conflict' | 'error';
export const entryCloudLabels: Record<EntryCloudStatus, string> = {
  source: '来源缓存 · 不上传', local: '未开启同步', pending: '待同步', synced: '已同步', conflict: '存在冲突', error: '需要处理'
};
export function useEntryCloudStatus(root: string | null | undefined, active: boolean, revision?: unknown) {
  const [snapshot, setSnapshot] = useState<{root: string; states: Record<string, EntryCloudStatus>; error: boolean} | null>(null);
  useEffect(() => {
    if (!root || !active || !('__TAURI_INTERNALS__' in window)) return;
    let closed = false; let busy = false; let dirty = false;
    const refresh = async () => {
      if (closed) return;
      if (busy || document.visibilityState === 'hidden') { dirty = true; return; }
      dirty = false;
      busy = true;
      try {
        const states = await cloudAccount<Record<string, EntryCloudStatus>>({ action: 'sync_entry_status', root });
        if (!closed) setSnapshot({root, states, error: false});
      } catch { if (!closed) setSnapshot({root, states: {}, error: true}); }
      finally { busy = false; if (dirty && !closed) void refresh(); }
    };
    void refresh();
    // Lightweight fallback for changes made outside Neuink. Saves and sync use events.
    const timer = window.setInterval(() => void refresh(), 120000);
    const stop = onCloudLibraryChanged(root, () => void refresh(), () => {});
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { closed = true; clearInterval(timer); stop(); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [root, active, revision]);
  return snapshot?.root === root ? snapshot : null;
}
