import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cloudAccount } from '@/shared/ipc/cloudAccountApi';
type Group = { token: string; entry_id: string; local_deleted: boolean; remote_deleted: boolean; members: { id: string; local: unknown; remote: unknown }[] };
/** The surrounding conflict DialogBody owns scrolling and keyboard focus. */
export function CloudDeletionGroup({ root, id, disabled, onResolved }: { root: string; id: string; disabled: boolean; onResolved: () => void }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [choice, setChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function inspect() {
    setBusy(true); setError(''); setGroup(null); setChoice(null);
    try { setGroup(await cloudAccount<Group>({ action: 'sync_deletion_group', root, id })); }
    catch (e) { setError(typeof e === 'string' ? e : '无法读取整组删除冲突。'); }
    finally { setBusy(false); }
  }
  async function resolve() {
    if (!group || choice === null || busy || disabled) return;
    setBusy(true); setError('');
    try { await cloudAccount({ action: 'sync_resolve_deletion_group', root, id, token: group.token, keep_local: choice }); setGroup(null); setChoice(null); onResolved(); }
    catch (e) { setError(typeof e === 'string' ? e : '处理失败，请重新核对。'); setGroup(null); setChoice(null); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2 border-t border-border pt-2">
    <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => void inspect()}>核对整组删除冲突</Button>
    {busy && <p role="status" className="text-xs">正在核对整篇及子内容…</p>}
    {group && <>
      <p className="text-sm">此选择同时处理论文目录和 {group.members.length - 1} 个子对象，包含这组中的其他本地或云端修改。</p>
      <p className="text-xs">本地：{group.local_deleted ? '整篇已在回收站' : '整篇仍保留'}；云端：{group.remote_deleted ? '整篇已删除' : '整篇仍保留'}。采用删除的一方会保留本地回收站副本。</p>
      {group.members.map(member => <details key={member.id} className="text-xs"><summary className="break-all">{member.id} · 本地{member.local == null ? '删除' : '保留'} / 云端{member.remote == null ? '删除' : '保留'}</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify({ 本地: member.local, 云端: member.remote }, null, 2)}</pre></details>)}
      {choice === null ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => setChoice(true)}>整组保留本地</Button><Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => setChoice(false)}>整组采用云端</Button></div> : <div className="space-y-2"><p role="alert">确认整组{choice ? '保留本地' : '采用云端'}？版本清单另存归档，本地已有内容保留在回收站或缓存；尚未下载的云端附件仍受历史保留期限约束。选中的变更将在后续同步应用。</p><Button size="sm" variant="outline" disabled={busy} onClick={() => setChoice(null)}>返回比较</Button><Button size="sm" disabled={disabled || busy} onClick={() => void resolve()}>确认整组处理</Button></div>}
    </>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
