import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cloudAccount } from '@/shared/ipc/cloudAccountApi';

type Preview = { token: string; versions: number; metadata_bytes: number; grace_days: number; history_days: number };
/** Preview belongs to this dialog; DialogBody owns scrolling. No drag behavior. */
export function CloudStorageCleanup() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function inspect() {
    setOpen(true); setBusy(true); setPreview(null); setError(''); setMessage('');
    try { setPreview(await cloudAccount<Preview>({ action: 'storage_cleanup_preview' })); }
    catch (e) { setError(typeof e === 'string' ? e : '无法读取清理预览，请重试。'); }
    finally { setBusy(false); }
  }
  async function clear() {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try {
      await cloudAccount({ action: 'storage_cleanup', token: preview.token });
      setPreview(null); setMessage('已清理预览中的云端旧版本。未被引用的附件将在等待期后回收。');
    } catch (e) { setError(typeof e === 'string' ? e : '清理未完成，请重新读取预览。'); setPreview(null); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="outline" size="sm" onClick={() => void inspect()}>清理云端旧版本</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent layout="bounded">
        <DialogHeader><DialogTitle>清理云端旧版本</DialogTitle><DialogDescription>默认保留旧版本和已删除内容 30 天。提前清理后，云端旧版本无法找回；当前内容和本地资料不受影响。</DialogDescription></DialogHeader>
        <DialogBody className="space-y-3 text-sm">
          {busy && <p role="status">正在核对云端内容…</p>}
          {preview && <><p>{preview.versions ? `可清理 ${preview.versions} 个旧版本，正文占用 ${(preview.metadata_bytes / 1048576).toFixed(2)} MB。` : '没有可清理的旧版本。'}</p><p>图片和 PDF 只有在当前内容、历史及上传任务均不再引用时才进入 {preview.grace_days} 天等待期。这里的数值不包含附件预计释放空间。</p><p>长期离线的设备之后可能需要重新核对同步内容。</p></>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {message && <p role="status">{message}</p>}
        </DialogBody>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>关闭</Button><Button variant="outline" disabled={busy} onClick={() => void inspect()}>重新读取</Button><Button variant="destructive" disabled={busy || !preview?.versions} onClick={() => void clear()}>确认清理这些旧版本</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
