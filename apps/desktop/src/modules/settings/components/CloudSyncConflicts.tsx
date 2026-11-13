import { useEffect, useId, useRef, useState } from 'react';
import { useFormRecovery } from '@/shared/hooks/useFormRecovery';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { CloudDeletionGroup } from './CloudDeletionGroup';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cloudAccount, type CloudConflict } from '@/shared/ipc/cloudAccountApi';

function describe(value: unknown): string {
  if (value == null) return '此版本中不存在（或已删除）';
  if (typeof value !== 'object') return String(value);
  const envelope = value as { document?: { payload: unknown; resources: { name: string; hash: string; size: number }[] } };
  if (!envelope.document) return JSON.stringify(value, null, 2);
  const { payload, resources } = envelope.document;
  return JSON.stringify(payload, null, 2) + (resources.length ? '\n\n附件与正文版本：\n' + resources.map(r => r.name + ' · ' + r.size + ' 字节 · ' + r.hash.slice(0, 12)).join('\n') : '');
}

/** Comparison state belongs to this dialog; DialogBody owns all scrolling. */
export function CloudSyncConflicts({ root, disabled, onResolved, showTrigger = true }: { root: string; disabled: boolean; onResolved: () => void; showTrigger?: boolean }) {
  const owner = useId();
  const [mergeToken, setMergeToken] = useState('');
  const [merge, setMerge] = useState<string | null>(null);
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<CloudConflict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const recovery = useFormRecovery({ root, id: 'cloud-conflict:' + (detail?.remote.object_id ?? 'unselected'),
    ownerId: 'cloud-conflict', targetId: 'data-cloud-account', label: '同步冲突合并',
    value: { markdown: merge ?? '', token: mergeToken }, dirty: merge !== null, ready: !!detail,
    restore: value => { setMerge(value.markdown); setMergeToken(value.token); setMergeConfirm(false); } });
  const current = useRef({ merge, busy, recovery }); current.current = { merge, busy, recovery };
  useEffect(() => {
    const stop = registerSegmentEditorCloseHandler('settings', owner, {
      ...recovery.handlers, settingsTargetId: 'data-cloud-account', isBusy: () => current.current.busy,
      isDirty: () => current.current.merge !== null,
      save: async () => { setError('请先在冲突窗口确认保存合并正文，或保留草稿后退出。'); return false; },
      discard: () => { current.current.recovery.discard(); setMerge(null); setMergeConfirm(false); },
    });
    return () => { stop(); setSegmentEditorDirty('settings', owner, false); };
  }, [owner]);
  useEffect(() => { setSegmentEditorDirty('settings', owner, merge !== null); }, [owner, merge]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); }
    catch (reason) { setError(typeof reason === 'string' ? reason : '冲突读取或处理失败，请重试'); }
    finally { setBusy(false); }
  }
  async function reload() {
    setDetail(null); setConfirm(null); setMerge(null); setMergeConfirm(false);
    setIds(await cloudAccount<string[]>({ action: 'sync_conflicts', root }));
  }
  return <>
    {showTrigger && <Button size="sm" variant="outline" disabled={disabled} onClick={() => { setOpen(true); void perform(reload); }}>查看及处理冲突</Button>}
    <Dialog open={open} onOpenChange={value => { if (!busy && (value || merge === null)) setOpen(value); }}>
      <DialogContent layout="bounded">
        <DialogHeader><DialogTitle>同步冲突</DialogTitle><DialogDescription>本地修改和云端版本均保留。选择完成后，在下一次同步发布或应用；暂停时等待继续。</DialogDescription></DialogHeader>
        <DialogBody className="space-y-3">
          {recovery.notice}
          {busy && <p role="status">正在核对…</p>}
          {!busy && !ids.length && !error && <p>当前没有待处理冲突。</p>}
          {ids.map(id => <Button key={id} variant={detail?.remote.object_id === id ? 'secondary' : 'outline'} className="mr-2 max-w-full truncate" disabled={busy || merge !== null} onClick={() => void perform(async () => {
            setConfirm(null); setMerge(null); setMergeConfirm(false); setDetail(await cloudAccount<CloudConflict>({ action: 'sync_conflict', root, id }));
          })}>{id}</Button>)}
          {detail && <>
            <p className="text-xs text-muted-foreground">正文附件的版本标识不同代表内容不同。需要手工合并时，先在原编辑器保存合并结果，再重新读取比较并保留本地。</p>
            {detail.remote.object_id.startsWith('note:') && <Button variant="outline" size="sm" disabled={busy || merge !== null} onClick={() => void perform(async () => {
              setDetail(await cloudAccount<CloudConflict>({ action: 'sync_conflict_notes', root, id: detail.remote.object_id }));
            })}>读取双方笔记正文</Button>}
            {detail.notes?.some(Boolean) && detail.notes.map((note, index) => <section key={index} className="border-t border-border pt-2">
              <h3 className="text-sm font-medium">{['基线正文', '本地正文', '云端正文'][index]}</h3>
              <p className="text-xs">{note?.title}</p><pre className="whitespace-pre-wrap break-words text-xs">{note?.markdown ?? '正文尚未读取或此版本不存在'}</pre>
            </section>)}
            {detail.notes?.[1] && detail.notes?.[2] && merge === null && <Button variant="outline" disabled={busy} onClick={() => { setMerge(detail.notes![1]!.markdown); setMergeToken(detail.token); setConfirm(null); }}>手工合并笔记正文</Button>}
            {merge !== null && <label className="block space-y-1 text-xs">合并后的笔记正文<Textarea aria-label="合并后的笔记正文" value={merge} disabled={busy || recovery.blocked} onChange={event => { setMerge(event.target.value); setMergeConfirm(false); }} /><span>标题、来源链接或附件也存在差异时会拒绝合并。合并编辑期间关闭操作暂停，请先保存或点击“放弃合并编辑”。</span></label>}
            {([['共同基线', detail.base], ['本地已保存', detail.local], ['云端版本', detail.remote.content]] as const).map(([label, value]) => <section key={label} className="space-y-1 border-t border-border pt-2">
              <h3 className="text-sm font-medium">{label}</h3><pre className="whitespace-pre-wrap break-all text-xs">{describe(value)}</pre>
            </section>)}
          </>}
          {detail && <CloudDeletionGroup key={detail.remote.object_id + detail.token} root={root} id={detail.remote.object_id} disabled={busy || merge !== null} onResolved={() => { void perform(async () => { await reload(); onResolved(); }); }} />}
          {mergeConfirm && <p role="alert">确认保存这份合并正文，并在下次同步发布？</p>}
          {confirm !== null && <p role="alert">{confirm ? '确认以本地已保存内容替代此云端版本？' : '确认采用云端版本，替代当前本地已保存内容？'} 比较期间有新修改时会拒绝提交。</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" disabled={busy || merge !== null} onClick={() => void perform(reload)}>重新读取</Button>
          {detail && detail.local !== null && !detail.remote.deleted && confirm === null && merge === null && <><Button variant="outline" disabled={busy} onClick={() => setConfirm(true)}>保留本地</Button><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>采用云端</Button></>}
          {detail && confirm !== null && <><Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>返回比较</Button><Button disabled={busy} onClick={() => void perform(async () => {
            await cloudAccount({ action: 'sync_resolve', root, id: detail.remote.object_id, token: detail.token, keep_local: confirm });
            await reload(); onResolved();
          })}>确认处理</Button></>}
          {detail && merge !== null && <><Button variant="outline" disabled={busy} onClick={() => { recovery.discard(); setMerge(null); setMergeConfirm(false); }}>放弃合并编辑</Button><Button disabled={busy || recovery.blocked} onClick={() => {
            if (!mergeConfirm) { setMergeConfirm(true); return; }
            void perform(async () => {
              await cloudAccount({ action: 'sync_merge_note', root, id: detail.remote.object_id, token: mergeToken, markdown: merge });
              recovery.discard(); await reload(); onResolved();
            });
          }}>{mergeConfirm ? '确认保存合并正文' : '保存合并正文'}</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
