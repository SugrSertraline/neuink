import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cloudAccount } from '@/shared/ipc/cloudAccountApi';
type Preview = { token: string; remote_objects: number; conflicts: number; local_retained: number; remote_applied: number; epoch_changed: boolean };
/** Dialog owns comparison state and its body owns scrolling; shared keyboard contract. */
export function CloudRebaseline({ root, disabled, onChanged }: { root: string; disabled: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function inspect() {
    setOpen(true); setBusy(true); setPreview(null); setError(''); setMessage('');
    try { setPreview(await cloudAccount<Preview>({ action: 'sync_rebaseline', root })); }
    catch (e) { setError(typeof e === 'string' ? e : '无法核对，请重试。'); }
    finally { setBusy(false); }
  }
  async function accept() {
    if (!preview || busy || disabled) return;
    setBusy(true); setError('');
    try {
      await cloudAccount({ action: 'sync_rebaseline', root, token: preview.token });
      setPreview(null); setMessage('核对已保存。下一次同步应用可确认的变更；冲突请在“查看及处理冲突”中选择。'); onChanged();
    } catch (e) { setError(typeof e === 'string' ? e : '确认未完成，请重新读取。'); setPreview(null); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="outline" size="sm" disabled={disabled} onClick={() => void inspect()}>重新核对云端内容</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent layout="bounded" className="h-auto max-h-[calc(100%-2rem)]">
        <DialogHeader><DialogTitle>重新核对同步内容</DialogTitle><DialogDescription>用于服务器恢复备份或设备长期离线。预览不会覆盖本地文件；双方都有修改的内容保留为冲突。</DialogDescription></DialogHeader>
        <DialogBody className="space-y-2 text-sm">
          {busy && <p role="status">正在读取并比较已保存内容…</p>}
          {preview && <><p>{preview.epoch_changed ? '服务器已恢复或重建，需要确认新的同步基线。' : '已取得当前云端完整快照。'}</p><dl className="grid grid-cols-2 gap-2"><dt>云端对象</dt><dd>{preview.remote_objects}</dd><dt>保留本地修改</dt><dd>{preview.local_retained}</dd><dt>准备接收云端内容</dt><dd>{preview.remote_applied}</dd><dt>双方修改待处理</dt><dd>{preview.conflicts}</dd></dl><p>确认时会再次核对。预览后有新保存或云端更新，将要求重新读取。</p></>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {message && <p role="status">{message}</p>}
        </DialogBody>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>关闭</Button><Button variant="outline" disabled={busy || disabled} onClick={() => void inspect()}>重新读取</Button><Button disabled={busy || disabled || !preview} onClick={() => void accept()}>确认这次核对</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
