import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cloudAccount, type CloudAccount, type CloudProfile } from '@/shared/ipc/cloudAccountApi';
import { ADMIN_PASSWORD_RESET_TARGET, type SettingsNavigationTarget } from '../settingsCatalog';

/** The exact command only opens this dialog; server authorization remains mandatory. */
export function CloudAdminPasswordReset({ navigationTarget, account, onChanged }: {
  navigationTarget?: SettingsNavigationTarget | null; account: CloudAccount | null; onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<'checking' | 'admin' | 'denied'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (navigationTarget?.id !== ADMIN_PASSWORD_RESET_TARGET) return;
    setPassword(''); setConfirm(''); setMessage(''); setOpen(true);
  }, [navigationTarget?.id, navigationTarget?.nonce]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPermission('checking');
    if (!account?.account_id) { setPermission('denied'); return; }
    void cloudAccount<CloudProfile>({ action: 'profile' }).then(profile => { if (alive) setPermission(profile.admin ? 'admin' : 'denied'); })
      .catch(() => { if (alive) setPermission('denied'); });
    return () => { alive = false; };
  }, [open, account?.account_id, account?.server_id]);
  async function submit() {
    if (busy || permission !== 'admin' || password.length < 12 || password !== confirm) return;
    setBusy(true); setMessage('');
    try {
      await cloudAccount({ action: 'admin_reset_password', new_password: password });
      setPassword(''); setConfirm('');
      await cloudAccount({ action: 'logout' });
      await onChanged();
      setMessage('密码已重置，全部设备需重新登录。本地资料保留。');
    } catch { setMessage('重置未完成，请核对管理员登录状态后重试。'); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (busy) return; setOpen(value); if (!value) { setPassword(''); setConfirm(''); setMessage(''); } }}>
    <DialogContent layout="bounded"><DialogHeader><DialogTitle>重置当前管理员密码</DialogTitle><DialogDescription>仅作用于当前登录的管理员账户，确认后撤销全部设备登录。指令不会自动执行重置。</DialogDescription></DialogHeader>
      <DialogBody><form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <p className="text-sm">当前账户：{account?.username ?? '未登录'}</p>
        {permission === 'checking' && <p role="status" className="text-xs">正在验证管理员身份…</p>}
        {permission === 'denied' && <p role="alert" className="text-xs text-muted-foreground">请先登录管理员账户，再重新输入完整指令。</p>}
        {permission === 'admin' && <>
          <label className="block space-y-1 text-xs">新管理员密码<Input type="password" autoComplete="new-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
          <label className="block space-y-1 text-xs">再次输入管理员密码<Input type="password" autoComplete="new-password" disabled={busy} value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
          <p className="text-xs text-muted-foreground">新密码至少 12 个字符。关闭窗口会清空输入。</p>
          <Button type="submit" variant="destructive" disabled={busy || password.length < 12 || password !== confirm}>{busy ? '正在重置…' : '确认重置并退出全部设备'}</Button>
        </>}
        {message && <p role="status" className="text-xs">{message}</p>}
      </form></DialogBody>
    </DialogContent>
  </Dialog>;
}
