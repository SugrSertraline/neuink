import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/shared/hooks/useToast';
import type { EditRecoveryDraft } from '@/shared/ipc/editRecoveryApi';
import { editRecoveryVersion, flushEditRecovery, forgetEditRecovery, loadEditRecovery, recoveryAvailable, recoveryState, requestEditRecovery, subscribeEditRecovery } from '@/shared/lib/editRecovery';

export function RecoveryCenter({ root, onOpen }: { root: string | null; onOpen: (draft: EditRecoveryDraft) => void }) {
  const center = useRecoveryCenter(root, onOpen);
  return <>{center.button}{center.dialog}</>;
}

export function useRecoveryCenter(root: string | null, onOpen: (draft: EditRecoveryDraft) => void) {
  useSyncExternalStore(subscribeEditRecovery, editRecoveryVersion, editRecoveryVersion);
  const { notify, dismiss } = useToast();
  const noticeId = useRef<string | null>(null);
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const notified = useRef(new Set<string>());
  const state = root && recoveryAvailable() ? recoveryState(root) : null;
  const drafts = state ? [...state.drafts.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  const current = drafts.find(item => item.key === selected) ?? drafts[0];
  const show = () => { if (noticeId.current) dismiss(noticeId.current); setOpen(true); };
  useEffect(() => {
    setOpen(false); setConfirm(null); setSelected(null);
    if (root && recoveryAvailable()) void loadEditRecovery(root).catch(() => {});
  }, [root]);
  useEffect(() => {
    if (!root || !state?.loaded || notified.current.has(root)) return;
    notified.current.add(root);
    if (state.restorable.size || state.unreadable) noticeId.current = notify({ title: '发现本地恢复草稿', durationMs: 15000,
      description: `${state.restorable.size} 项未保存内容可查看。草稿保留在当前文献库，正式内容没有改变。`,
      action: <Button size="sm" variant="outline" onClick={show}>查看草稿</Button> });
  }, [root, state?.loaded, notify]);
  const remove = async () => {
    if (!root || !current || busy) return;
    if (confirm !== current.key) { setConfirm(current.key); return; }
    setBusy(true);
    try { forgetEditRecovery(root, current.key); await flushEditRecovery(root); setConfirm(null); }
    catch { /* The storage error remains visible below; no canonical content changes. */ }
    finally { setBusy(false); }
  };
  const preview = current ? String(current.payload.markdown ?? current.payload.text ?? current.payload.content ?? JSON.stringify(current.payload.value ?? current.payload, null, 2)) : '';
  const button = drafts.length || state?.error || state?.unreadable ? <Button variant="ghost" size="sm" onClick={show}>
    本地草稿 {drafts.length || ''}</Button> : null;
  const dialog = <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <DialogContent layout="bounded" className="h-auto max-h-[calc(100%-2rem)]" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>本地恢复草稿</DialogTitle><DialogDescription>查看备份内容和记录时间，打开对应页面后恢复并保存。系统强制结束时，可恢复到最近一次成功写入的备份。</DialogDescription></DialogHeader>
      <DialogBody className="max-h-[28rem]">
        {state?.error ? <div role="alert" className="mb-2 text-destructive">{state.error}<Button variant="outline" size="sm" onClick={() => { if (root) void flushEditRecovery(root).catch(() => {}); }}>重试</Button></div> : null}
        {state?.unreadable ? <p role="alert" className="mb-2 text-destructive">有 {state.unreadable} 条恢复记录无法读取，原文件仍保留在文献库的 .neuink-recovery 目录。</p> : null}
        {!drafts.length ? <p className="py-8 text-center text-muted-foreground">没有待恢复的草稿。</p> : <>
          <ul className="divide-y rounded-md border">{drafts.map(draft => <li key={draft.key}>
            <button className={`w-full min-w-0 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${current?.key === draft.key ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}
              onClick={() => { setSelected(draft.key); setConfirm(null); }} aria-pressed={current?.key === draft.key}>
              <div className="truncate" title={draft.label}>{draft.label}</div>
              <div className="text-xs text-muted-foreground">{new Date(draft.updatedAt).toLocaleString()} · {state?.pending.has(draft.key) ? '备份待写入' : '本地已备份'}</div>
            </button></li>)}</ul>
          <label className="mt-3 block text-xs text-muted-foreground" htmlFor="recovery-content">草稿内容（只读，可复制）</label>
          {current?.secretRef || current?.secrets ? <p className="mt-1 text-xs text-muted-foreground">包含安全凭据。密钥单独保存在本机系统凭据库，此处不显示；恢复时需要原电脑和原账户。</p> : null}
          <textarea id="recovery-content" readOnly value={preview} className="mt-1 min-h-40 w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
        </>}
        {confirm ? <p role="alert" className="mt-2 text-destructive">确认放弃这条本地恢复草稿？正式笔记不会改变。</p> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>关闭</Button>
        <Button variant={confirm ? 'destructive' : 'outline'} disabled={busy || !current || !state?.restorable.has(current.key)} onClick={() => void remove()}>{confirm ? '确认放弃草稿' : '放弃草稿'}</Button>
        <Button disabled={busy || !current} onClick={() => { if (!root || !current) return; requestEditRecovery(root, current.key); setOpen(false); onOpen(current); }}>打开对应页面</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
  return { button, dialog };
}
