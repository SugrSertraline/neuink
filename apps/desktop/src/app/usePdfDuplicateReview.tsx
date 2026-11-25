import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/shared/hooks/useToast';
import type { PdfDuplicateReview } from '@/shared/lib/pdfDuplicate';

type PendingReview = PdfDuplicateReview & { resolve: (confirmed: boolean) => void; toastId: string };

export function usePdfDuplicateReview() {
  const { dismiss, notify } = useToast();
  const pendingRef = useRef(new Map<string, PendingReview>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const settle = useCallback((id: string, confirmed: boolean) => {
    const pending = pendingRef.current.get(id);
    if (!pending) return;
    pendingRef.current.delete(id);
    pending.resolve(confirmed);
    setActiveId(current => current === id ? null : current);
    dismiss(pending.toastId);
  }, [dismiss]);

  const confirm = useCallback((review: PdfDuplicateReview) => new Promise<boolean>(resolve => {
    const id = crypto.randomUUID();
    const toastId = notify({
      title: '发现内容重复的 PDF',
      description: `待添加“${review.candidateTitle}”与已有论文“${review.duplicate.title}”的 PDF 内容相同。`,
      durationMs: Infinity,
      action: <Button type="button" size="xs" variant="outline" onClick={() => setActiveId(id)}>查看详情</Button>,
      onDismiss: () => settle(id, false)
    });
    pendingRef.current.set(id, { ...review, resolve, toastId });
  }), [notify, settle]);

  useEffect(() => () => {
    for (const [id, pending] of pendingRef.current) {
      pendingRef.current.delete(id);
      pending.resolve(false);
      dismiss(pending.toastId);
    }
  }, [dismiss]);

  const active = activeId ? pendingRef.current.get(activeId) : null;
  const sourceFileName = active?.sourcePath.split(/[\\/]/).pop() || active?.sourcePath || '';
  const dialog = <Dialog open={Boolean(active)} onOpenChange={open => { if (!open && activeId) settle(activeId, false); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>确认重复的 PDF</DialogTitle>
        <DialogDescription>系统按 PDF 文件内容核对；文件名和条目标题不参与判断。</DialogDescription>
      </DialogHeader>
      {active ? <div className="space-y-3 text-sm">
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">待添加</p>
          <p className="mt-1 break-words font-medium">{active.candidateTitle}</p>
          <p className="mt-0.5 break-all text-xs text-muted-foreground">{sourceFileName}</p>
        </div>
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
          <p className="text-xs text-muted-foreground">本地已有 · {active.duplicate.inTrash ? '回收站' : '条目库'}</p>
          <p className="mt-1 break-words font-medium">{active.duplicate.title}</p>
          <p className="mt-0.5 break-all text-xs text-muted-foreground">{active.duplicate.fileName}</p>
        </div>
        <p className="text-xs text-muted-foreground">继续后会保存第二份相同内容的 PDF，已有论文及其文件不会被覆盖。</p>
      </div> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => { if (activeId) settle(activeId, false); }}>取消添加</Button>
        <Button type="button" onClick={() => { if (activeId) settle(activeId, true); }}>仍要添加</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;

  return { confirm, dialog };
}
