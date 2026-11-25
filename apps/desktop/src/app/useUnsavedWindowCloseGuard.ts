import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/shared/hooks/useToast';
import { hasAnyUnsavedEdits, saveEditsBeforeWorkspaceChange } from './editSafety';
import { listUnsavedEditors } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { flushAllEditRecovery, hasPendingEditRecovery, isRecoveryBackedUp, isRecoveryExit, setRecoveryExit } from '@/shared/lib/editRecovery';
import type { UnsavedEditor } from './UnsavedWindowDialog';
import { getAssistantBackgroundRuns, getAssistantMessageQueues, resumeAssistantBackgroundWorkAfterFailedClose, stopAssistantBackgroundWorkForClose } from '@/modules/assistant/components/assistantBackgroundRuns';

export function useUnsavedWindowCloseGuard(options: { onReveal?: (target: UnsavedEditor) => void } = {}) {
  const { notify } = useToast();
  const [targets, setTargets] = useState<UnsavedEditor[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const context = useRef(options); context.current = options;
  const live = useRef(true), closing = useRef(false), readyToClose = useRef(false);
  const lastCloseAt = useRef<number | null>(null), forcing = useRef(false);
  const showEdits = () => {
    const pending = listUnsavedEditors();
    setTargets(pending); setError(null);
    try { if (pending[0]) context.current.onReveal?.(pending[0]); } catch { /* The exit dialog must remain available even if navigation fails. */ }
    notify({ tone: 'default', title: '仍有未保存的修改', description: '请处理未保存内容；3 秒内再次点击右上角关闭，将不保存并强制退出。' });
  };
  const showRef = useRef(showEdits); showRef.current = showEdits;
  const keepIsSafe = () => {
    const pending = listUnsavedEditors();
    return (!hasAnyUnsavedEdits() || pending.length > 0) && pending.every(({ handler }) => {
      const reference = handler?.recovery?.();
      return !handler?.isBusy?.() && reference && isRecoveryBackedUp(reference.root, reference.key);
    });
  };
  const finish = async (mode: 'clean' | 'save' | 'keep' | 'discard') => {
    if (closing.current) return;
    closing.current = true; setBusy(true); setError(null);
    try {
      if (mode === 'save') await saveEditsBeforeWorkspaceChange();
      if (mode === 'discard') {
        const pending = listUnsavedEditors();
        if (!pending.length || pending.some(item => !item.ownerId.startsWith('entry-metadata:') && !item.ownerId.startsWith('field-definitions:')) || pending.some(item => item.handler?.isBusy?.())) throw new Error('存在其他未保存修改，请先分别处理。');
        pending.forEach(item => item.handler?.discard());
      }
      if (mode === 'keep') listUnsavedEditors().forEach(({ handler }) => handler?.checkpoint?.());
      if (hasPendingEditRecovery()) await flushAllEditRecovery();
      if (mode === 'keep' && !keepIsSafe()) throw new Error('部分修改尚未安全备份，或仍有正在写入的操作。请点击“去处理”完成这些项目后再退出。');
      await stopAssistantBackgroundWorkForClose();
      if (!live.current) return;
      if (mode === 'keep') listUnsavedEditors().forEach(({ handler }) => handler?.checkpoint?.());
      await flushAllEditRecovery();
      if (mode === 'keep' ? !keepIsSafe() : hasAnyUnsavedEdits()) throw new Error('退出前又出现未保存的修改，请检查对应页面后重试。');
      readyToClose.current = true;
      setRecoveryExit(true);
      await getCurrentWindow().close();
    } catch (caught) {
      readyToClose.current = false; setRecoveryExit(false);
      resumeAssistantBackgroundWorkAfterFailedClose();
      if (live.current) {
        const pending = listUnsavedEditors(); setTargets(pending);
        if (pending[0]) context.current.onReveal?.(pending[0]);
        setError(caught instanceof Error ? caught.message : '关闭失败，请重试。');
      }
    } finally { closing.current = false; if (live.current) setBusy(false); }
  };
  const finishRef = useRef(finish); finishRef.current = finish;
  useEffect(() => {
    live.current = true; readyToClose.current = false; setRecoveryExit(false);
    let disposed = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (readyToClose.current && isRecoveryExit()) return;
      if (!hasAnyUnsavedEdits() && !hasPendingEditRecovery() && getAssistantBackgroundRuns().length === 0 && getAssistantMessageQueues().length === 0) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    let unlisten: (() => void) | undefined;
    if (isTauri()) void getCurrentWindow().onCloseRequested(event => {
      if (readyToClose.current) return;
      const dirty = hasAnyUnsavedEdits();
      const runs = getAssistantBackgroundRuns();
      const queuedCount = getAssistantMessageQueues().reduce((count, queue) => count + queue.items.length, 0);
      if (!dirty && !hasPendingEditRecovery() && runs.length === 0 && queuedCount === 0) return;
      event.preventDefault();
      const now = Date.now();
      const previous = lastCloseAt.current;
      lastCloseAt.current = now;
      if (previous !== null && now >= previous && now - previous <= 3000) {
        if (forcing.current) return;
        forcing.current = true;
        readyToClose.current = true;
        setRecoveryExit(true);
        void getCurrentWindow().destroy().catch(caught => {
          forcing.current = false; readyToClose.current = false; lastCloseAt.current = null; setRecoveryExit(false);
          if (live.current) { showRef.current(); setError(caught instanceof Error ? caught.message : '强制关闭失败，请重试。'); }
        });
        return;
      }
      if (closing.current) return;
      if (dirty) { showRef.current(); return; }
      if (runs.length || queuedCount) notify({ tone: 'default', title: '正在结束任务', description: `正在停止 ${runs.length} 个助手任务并清除 ${queuedCount} 条待发送消息。3 秒内再次点击关闭将强制退出。` });
      else notify({ tone: 'default', title: '正在完成保存', description: '3 秒内再次点击右上角关闭，将不等待保存并强制退出。' });
      void finishRef.current('clean');
    }).then(cleanup => { if (disposed) cleanup(); else unlisten = cleanup; })
      .catch(() => { if (!disposed) notify({ tone: 'danger', title: '退出保护未能启用', description: '请在退出前手动保存所有修改，并等待或停止助手任务。' }); });
    return () => { disposed = true; live.current = false; setRecoveryExit(false); unlisten?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [notify]);
  const edit = (target?: UnsavedEditor) => { if (closing.current) return; lastCloseAt.current = null; setTargets(null); const next = target ?? listUnsavedEditors()[0]; if (next) context.current.onReveal?.(next); };
  return { targets, busy, error, onEdit: edit, onCancel: () => edit(), onSave: () => void finish('save'), onKeep: () => void finish('keep'), onDiscard: () => void finish('discard') };
}
