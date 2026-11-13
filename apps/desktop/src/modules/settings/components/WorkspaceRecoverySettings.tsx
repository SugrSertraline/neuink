import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cloudAccount } from '@/shared/ipc/cloudAccountApi';
type Item = { name: string; token: string; bytes: number; cache_files: number };
/** This remains usable without login and when ordinary workspace opening fails. */
export function WorkspaceRecoverySettings() {
  const [open, setOpen] = useState(false); const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  async function inspect() {
    setOpen(true); setBusy(true); setError(''); setSelected(null);
    try { setItems(await cloudAccount<Item[]>({ action: 'recovery_inspect' })); }
    catch (e) { setError(typeof e === 'string' ? e : '无法读取恢复记录。'); }
    finally { setBusy(false); }
  }
  async function resolve(keep: boolean) {
    if (busy || (keep && !selected)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (keep && selected) {
        const result = await cloudAccount<{ archive: string }>({ action: 'recovery_keep_current', name: selected.name, token: selected.token });
        setMessage(`已保留当前文件，恢复材料归档于：${result.archive}。自动同步保持暂停，请先检查内容。`);
      } else { await cloudAccount({ action: 'recovery_retry' }); setMessage('恢复重试已完成。保存其他编辑后，可重新打开资料库或重启应用。'); }
      setSelected(null); setItems(await cloudAccount<Item[]>({ action: 'recovery_inspect' }));
    } catch (e) { setError(typeof e === 'string' ? e : '恢复未完成，原文件及记录仍保留。'); setSelected(null); }
    finally { setBusy(false); }
  }
  return <>
    <Button size="sm" variant="outline" onClick={() => void inspect()}>检查未完成的保存与同步</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent layout="bounded"><DialogHeader><DialogTitle>未完成操作恢复</DialogTitle><DialogDescription>程序中断后通常会自动接续保存。若文件被外部修改而阻止打开，可在这里重试，或保留当前文件并归档原操作。</DialogDescription></DialogHeader>
        <DialogBody className="space-y-3 text-sm">
          {busy && <p role="status">正在核对恢复记录…</p>}
          {!busy && !items.length && !error && <p>没有待处理的恢复记录。</p>}
          {items.map(item => <div key={item.name} className="space-y-1 border-b border-border pb-2"><p className="break-all">{item.name}</p><p className="text-xs">记录 {(item.bytes / 1024).toFixed(1)} KB；引用 {item.cache_files} 份缓存材料。</p><Button size="sm" variant="outline" disabled={busy} onClick={() => setSelected(item)}>选择保留当前文件</Button></div>)}
          {selected && <p role="alert">确认停止接续这条操作，并保留当前文件？原操作记录和可用缓存材料会另存归档，已经写入的部分不会回滚；尚未写入的内容可能只存在于归档中。自动同步将暂停，请核对论文与笔记后再继续。</p>}
          {error && <p role="alert" className="text-destructive">{error}</p>}{message && <p role="status" className="break-all">{message}</p>}
        </DialogBody>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>关闭</Button><Button variant="outline" disabled={busy} onClick={() => void inspect()}>重新读取</Button><Button variant="outline" disabled={busy || !items.length} onClick={() => void resolve(false)}>重试恢复</Button>{selected && <Button disabled={busy} onClick={() => void resolve(true)}>确认归档并保留当前文件</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
