import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, UserRound } from 'lucide-react';
import { CloudAvatarEditor } from './CloudAvatarEditor';
import { CloudStorageCleanup } from './CloudStorageCleanup';
import { Button } from '@/components/ui/button';
import { useFormRecovery } from '@/shared/hooks/useFormRecovery';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cloudAccount, type CloudProfile, type CloudStorage, type CloudAccount } from '@/shared/ipc/cloudAccountApi';

const fields = [
  ['nickname', '昵称', 80], ['full_name', '姓名', 120], ['email', '邮箱', 254],
  ['affiliation', '单位／学校', 200], ['bio', '个人简介', 1000],
] as const;
const size = (bytes: number) => `${(bytes / 1073741824).toFixed(2)} GB`;

/** Owns the editable draft; the shared dialog owns editing scroll and keyboard focus. */
export function CloudProfileSettings({ account }: { account: CloudAccount }) {
  const owner = useId();
  const [editing, setEditing] = useState(false);
  const baseline = useRef<CloudProfile | null>(null);
  const [profile, setProfile] = useState<CloudProfile | null>(null);
  const [remote, setRemote] = useState<CloudProfile | null>(null);
  const [storage, setStorage] = useState<CloudStorage | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [dirty, setDirty] = useState(false);
  const recovery = useFormRecovery({ id: 'cloud-profile:' + account.server_id + ':' + account.account_id,
    ownerId: 'cloud-account', label: '云端个人资料', targetId: 'account-profile', value: profile, dirty,
    ready: !!profile, restore: value => { if (value) { setProfile(value); setDirty(true); setEditing(true); } } });
  const latest = useRef({ busy, dirty, recovery }); latest.current = { busy, dirty, recovery };
  useEffect(() => {
    const unregister = registerSegmentEditorCloseHandler('settings', owner, {
      ...recovery.handlers, settingsTargetId: 'account-profile', isBusy: () => latest.current.busy,
      isDirty: () => latest.current.dirty,
      save: async () => { setMessage('请先保存或放弃个人资料修改。'); return !latest.current.dirty; },
      discard: () => { latest.current.recovery.discard(); setProfile(baseline.current); setDirty(false); },
    });
    return () => { unregister(); setSegmentEditorDirty('settings', owner, false); };
  }, [owner]);
  useEffect(() => { setSegmentEditorDirty('settings', owner, dirty); }, [owner, dirty]);
  useEffect(() => {
    let current = true;
    setBusy(true); setMessage('');
    Promise.all([cloudAccount<CloudProfile>({ action: 'profile' }), cloudAccount<CloudStorage>({ action: 'storage' })])
      .then(([value, usage]) => { if (current) { baseline.current = value; setProfile(value); setStorage(usage); setDirty(false); } })
      .catch(() => { if (current) { setError(true); setMessage('个人资料暂时无法读取，请重试。'); } })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [reload]);
  async function save() {
    if (!profile || busy || recovery.blocked) return;
    setBusy(true); setMessage(''); setError(false);
    try {
      const result = await cloudAccount<{profile_revision:number}>({ action: 'save_profile', profile });
      baseline.current = { ...profile, profile_revision: result.profile_revision };
      recovery.discard(); setProfile(baseline.current); setDirty(false); setRemote(null); setEditing(false); setMessage('个人资料已保存。');
    } catch (caught) { setError(true); setMessage(typeof caught === 'string' ? caught : '保存失败，修改仍保留在当前页面。'); }
    finally { setBusy(false); }
  }
  return <section id="account-profile" aria-label="个人资料" className="space-y-4">
    {recovery.notice}
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground">
          {baseline.current?.avatar ? <img src={baseline.current.avatar} alt="账户头像" className="size-full object-cover" /> : <UserRound aria-label="默认头像" className="size-9" strokeWidth={1.5} />}
        </div>
        <Button type="button" size="sm" variant="ghost" disabled={!profile || busy} onClick={() => { setEditing(true); setMessage(''); }}>编辑头像</Button>
      </div>
      <div className="min-w-48 flex-1 space-y-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="break-words text-base font-semibold leading-6">{baseline.current?.nickname?.trim() || '默认昵称'}</h3>
            <p className="break-all text-xs text-muted-foreground">账号：{account.username}</p>
          </div>
          <Button size="sm" variant="outline" disabled={!profile || busy} onClick={() => { setEditing(true); setMessage(''); }}>编辑</Button>
        </div>
        {profile && <dl className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">{fields.filter(([key]) => key !== 'nickname').map(([key,label]) => <div className={key === 'bio' ? 'flex gap-2 sm:col-span-2' : 'flex gap-2'} key={key}><dt className="w-16 shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{baseline.current?.[key]?.trim() || '未填写'}</dd></div>)}</dl>}
      </div>
      {storage && <div className="w-52 space-y-2 text-xs">
        <p className="font-medium">云端空间</p><p>{size(storage.used_bytes)} / {size(storage.quota)}</p>
        <progress aria-label="云端空间使用量" className="h-2 w-full accent-primary" max={Math.max(storage.quota, 1)} value={Math.min(storage.used_bytes, Math.max(storage.quota, 1))} />
        <p className="leading-5 text-muted-foreground">附件 {size(storage.file_bytes)}<br />正文与历史 {size(storage.metadata_bytes)} · 预留 {size(storage.reserved_bytes)}</p>
        <CloudStorageCleanup />
        {storage.available_bytes === 0 && <p role="status">可用空间已用完，新增上传会暂停；本地资料仍可使用。</p>}
      </div>}
    </div>
    {!profile ? busy ? <div role="status" aria-busy="true" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />正在读取个人资料…</div> : <Button variant="outline" onClick={() => setReload(n => n + 1)}>重新读取资料</Button> : <>
      <Dialog open={editing} onOpenChange={open => {
        if (busy) return;
        if (!open && dirty) { setError(true); setMessage('修改尚未保存，请保存或点击“放弃修改”。'); return; }
        setEditing(open);
      }}>
        <DialogContent layout="bounded"><DialogHeader><DialogTitle>编辑个人资料</DialogTitle><DialogDescription>所有资料均可留空；保存后更新账户显示。</DialogDescription></DialogHeader>
          <DialogBody className="space-y-4">
      <CloudAvatarEditor value={profile.avatar || ''} disabled={busy || recovery.blocked} onChange={avatar => { setProfile({ ...profile, avatar }); setDirty(true); }} />
      <div className="grid gap-4 sm:grid-cols-2">{fields.map(([key, label, limit]) => <label className="block space-y-2 text-xs" key={key}>
        {label}<Input value={profile[key]} maxLength={limit} disabled={busy || recovery.blocked} type={key === 'email' ? 'email' : 'text'} onChange={event => { setProfile({ ...profile, [key]: event.target.value }); setDirty(true); }} />
      </label>)}</div>
      <p className="text-xs leading-5 text-muted-foreground">以上资料均可留空。邮箱尚未验证，暂不用于登录或找回密码。</p>
      <Button disabled={busy || !dirty || recovery.blocked} onClick={() => void save()}>{busy ? '正在保存…' : '保存'}</Button>
      {dirty && <Button variant="outline" disabled={busy || recovery.blocked} onClick={() => {
        setBusy(true); setError(false);
        void cloudAccount<CloudProfile>({ action: 'profile' }).then(current => {
          baseline.current = current;
          setProfile(previous => previous ? { ...previous, profile_revision: current.profile_revision } : current);
          setMessage('已读取最新版本，保留你的填写内容。请核对下面的云端资料后再次保存。');
          setRemote(current);
        }).catch(() => { setError(true); setMessage('无法读取云端资料，请重试。'); }).finally(() => setBusy(false));
      }}>读取云端版本以比较</Button>}
      {remote && <div className="space-y-1 border-t border-border pt-2 text-xs"><p>云端当前资料（你的填写内容仍保留在上方）：</p>{remote.avatar ? <img src={remote.avatar} alt="云端当前头像" className="size-12 rounded-full object-cover" /> : <p>头像：默认头像</p>}{fields.map(([key, label]) => <p key={key}>{label}：{remote[key] || '未填写'}</p>)}</div>}

            {message && <p role={error ? 'alert' : 'status'} className="text-xs text-destructive">{message}</p>}
          </DialogBody>
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => {
            recovery.discard(); setProfile(baseline.current); setDirty(false); setRemote(null); setMessage(''); setEditing(false);
          }}>{dirty ? '放弃修改' : '关闭'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>}
    {!editing && message && <p role={error ? 'alert' : 'status'} className={`text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>}
  </section>;
}
