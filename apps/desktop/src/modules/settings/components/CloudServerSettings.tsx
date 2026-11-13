import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cloudAccount } from '@/shared/ipc/cloudAccountApi';
import { cloudServerAddress } from './cloudServerAddress';

/** Draft and request state belong here; DialogBody owns scrolling and shared Dialog owns focus. */
export function CloudServerSettings({ endpoint, loggedIn, disabled, onChanged }: { endpoint: string; loggedIn: boolean; disabled: boolean; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(endpoint);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  async function save() {
    if (busy || loggedIn || !draft.trim()) return;
    setBusy(true); setMessage(''); setFailed(false);
    try {
      await cloudAccount({ action: 'connect', endpoint: cloudServerAddress(draft) });
      await onChanged(); setMessage('服务器连接成功，设置已保存。');
    } catch (reason) { setFailed(true); setMessage(typeof reason === 'string' ? reason : '连接未完成，请检查地址后重试。'); }
    finally { setBusy(false); }
  }
  return <section className="contents">
    <Button size="sm" variant="outline" disabled={disabled} onClick={() => { setDraft(endpoint); setMessage(''); setOpen(true); }}>服务器设置</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent layout="bounded" className="h-auto max-h-[calc(100%-2rem)] max-w-md sm:max-w-md"><DialogHeader><DialogTitle>服务器设置</DialogTitle><DialogDescription>请在东北大学校园网环境下连接服务器。修改后需连接成功才能保存；关闭窗口放弃未保存的地址。</DialogDescription></DialogHeader>
        <DialogBody><form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
          <label className="block space-y-2 text-xs">服务器地址<Input value={draft} disabled={busy || loggedIn} onChange={event => setDraft(event.target.value)} /></label>
          {loggedIn && <p className="text-xs text-muted-foreground">已登录，修改服务器前请先退出账号。</p>}
          <Button type="submit" size="sm" disabled={busy || loggedIn || !draft.trim()}>{busy ? '正在连接…' : '连接并保存'}</Button>
          {message && <p role={failed ? 'alert' : 'status'} className={`text-xs ${failed ? 'text-destructive' : 'text-muted-foreground'}`}>{message}</p>}
        </form></DialogBody>
      </DialogContent>
    </Dialog>
  </section>;
}
