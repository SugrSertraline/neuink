import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { clearNoteEditDraft } from '@/modules/notes/editor/noteEditLease';
import { saveMarkdownNoteBeforeClose } from '@/modules/notes/editor/noteDirtyRegistry';
import { discardSegmentEditorsBeforeClose, saveSegmentEditorsBeforeClose, hasUnsavedSegmentEditors } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { hasUnsavedSurface } from './editSafety';
import { surfaceKey, surfaceNoteTarget, type WorkspacePaneId, type WorkspaceSurface } from './workspaceSurface';
import { noteOwnerKey } from '@/shared/lib/noteOwner';

export type SurfaceCloseTarget = { pane: WorkspacePaneId; surface: WorkspaceSurface; scopeKey?: string };
const isDirty = ({ surface, scopeKey }: SurfaceCloseTarget) => scopeKey ? hasUnsavedSegmentEditors(scopeKey) : hasUnsavedSurface(surface);

export function useSurfaceCloseGuard({ root, onClose }: { root: string | null; onClose: (targets: SurfaceCloseTarget[]) => void }) {
  const [pending, setPending] = useState<{ root: string | null; targets: SurfaceCloseTarget[]; transition?: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const returnFocus = useRef<{ root: string | null; element: HTMLElement } | null>(null);
  const context = useRef({ root, onClose });
  context.current = { root, onClose };
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { setPending(null); setError(null); }, [root]);

  const requestClose = (targets: SurfaceCloseTarget[], transition?: () => void) => {
    if (busyRef.current || pending || targets.length === 0) return;
    if (targets.some(isDirty)) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? { root, element: document.activeElement } : null;
      setError(null);
      setPending({ root, targets, transition });
    } else if (transition) transition();
    else onClose(targets);
  };
  const finish = () => {
    if (!pending || pending.root !== context.current.root || !live.current) return;
    // Close only the captured targets, never a fresh 'close others' set after an await.
    if (pending.transition) pending.transition();
    else context.current.onClose(pending.targets);
    setPending(null);
  };
  const discard = () => {
    if (!pending || busyRef.current || pending.root !== context.current.root) return;
    for (const { surface, scopeKey } of pending.targets) {
      discardSegmentEditorsBeforeClose(scopeKey ?? surfaceKey(surface));
      const target = scopeKey ? null : surfaceNoteTarget(surface);
      if (target) clearNoteEditDraft(noteOwnerKey(target.owner), target.note_id);
    }
    finish();
  };
  const save = async () => {
    if (!pending || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const current = () => live.current && pending.root === context.current.root;
    try {
      for (const { surface, scopeKey } of pending.targets) {
        if (!current()) return;
        if (!isDirty({ pane: 'left', surface, scopeKey })) continue;
        const target = scopeKey ? null : surfaceNoteTarget(surface);
        const saved = target
          ? await saveMarkdownNoteBeforeClose(noteOwnerKey(target.owner), target.note_id)
          : await saveSegmentEditorsBeforeClose(scopeKey ?? surfaceKey(surface));
        if (!saved) throw new Error('部分内容未能保存，或保存期间又有修改。所有待关闭页面仍保持打开，请返回编辑器处理后重试。');
      }
      if (!current()) return;
      if (pending.targets.some(isDirty)) throw new Error('保存期间又有修改，请重新保存。');
      finish();
    } catch (caught) { if (current()) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { busyRef.current = false; if (live.current) setBusy(false); }
  };
  const dialog = <Dialog open={pending !== null && pending.root === root} onOpenChange={(open) => { if (!open && !busyRef.current) setPending(null); }}>
    <DialogContent showCloseButton={!busy} onCloseAutoFocus={(event) => {
      event.preventDefault();
      const target = returnFocus.current;
      if (target?.root === context.current.root && target.element.isConnected) target.element.focus();
    }}>
      <DialogHeader><DialogTitle>{pending?.transition ? '保存修改后再继续？' : '保存修改后再关闭？'}</DialogTitle>
        <DialogDescription>待操作的 {pending?.targets.length ?? 0} 个页面中有未保存的设置、条目信息、标签描述、阅读进度、文档笔记、片段笔记或批注。保存失败时保留当前页面。</DialogDescription></DialogHeader>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      <DialogFooter className="flex-wrap">
        <Button disabled={busy} variant="outline" onClick={() => setPending(null)}>取消</Button>
        <Button disabled={busy} variant="destructive" onClick={discard}>{pending?.transition ? '放弃未保存修改并继续' : '不保存并关闭'}</Button>
        <Button disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : pending?.transition ? '保存并继续' : '保存并关闭'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
  return { requestClose, dialog };
}
