import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cloudAccount } from '@/shared/ipc/cloudAccountApi';

export function CloudPasswordSettings({ loggedIn, onChanged }: { loggedIn: boolean; endpoint: string; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  async function submit() {
    if (busy || !proof || password.length < 12 || password !== confirm) return;
    setBusy(true); setMessage(''); setError(false);
    try {
      await cloudAccount({ action: 'password', old_password: proof, new_password: password });
      await cloudAccount({ action: 'logout' });
      setProof(''); setPassword(''); setConfirm('');
      setMessage('密码已更新，旧会话已撤销，请使用新密码登录。');
      await onChanged();
    } catch (reason) { setError(true); setMessage(typeof reason === 'string' ? reason : '密码更新未完成，请重试'); }
    finally { setBusy(false); }
  }
  if (!loggedIn) return null;
  return <section className="contents" aria-label="修改密码">
    <Button variant="outline" size="sm" onClick={() => { setMessage(''); setOpen(true); }}>修改密码</Button>
    <Dialog open={open} onOpenChange={value => { if (busy) return; setOpen(value); if (!value) { setProof(''); setPassword(''); setConfirm(''); setMessage(''); } }}>
      <DialogContent layout="bounded"><DialogHeader><DialogTitle>修改密码</DialogTitle><DialogDescription>输入验证信息和新密码。关闭窗口会清空密码输入。</DialogDescription></DialogHeader><DialogBody>
    <form className="space-y-3 pt-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className="block space-y-1 text-xs">当前密码<Input type="password" autoComplete={loggedIn ? 'current-password' : 'off'} disabled={busy} value={proof} onChange={event => setProof(event.target.value)} /></label>
      <label className="block space-y-1 text-xs">新密码<Input type="password" autoComplete="new-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label className="block space-y-1 text-xs">再次输入新密码<Input type="password" autoComplete="new-password" disabled={busy} value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
      <p className="text-xs text-muted-foreground">密码至少 12 个字符，不强制字符组合。更新后全部设备需重新登录；本地资料保留。此表单不保存密码草稿。</p>
      {confirm && confirm !== password && <p role="status" className="text-xs">两次输入的新密码不一致。</p>}
      <Button type="submit" size="sm" disabled={busy || !proof || password.length < 12 || password !== confirm}>{busy ? '正在更新…' : '确认更新密码并撤销旧会话'}</Button>
      {message && <p role={error ? 'alert' : 'status'} className="text-xs">{message}</p>}
    </form>
      </DialogBody></DialogContent>
    </Dialog>
  </section>;
}
