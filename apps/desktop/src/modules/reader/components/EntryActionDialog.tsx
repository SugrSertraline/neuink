import { AlertTriangle, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

import type { LibraryEntry } from '../../library/components/LibrarySidebar';

type EntryAction = 'move-to-trash' | 'purge';

type EntryActionDialogProps = {
  action: EntryAction;
  busy: boolean;
  entry: LibraryEntry | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

export function EntryActionDialog({
  action,
  busy,
  entry,
  onConfirm,
  onOpenChange
}: EntryActionDialogProps) {
  const isPurge = action === 'purge';

  return (
    <Dialog open={Boolean(entry)} onOpenChange={onOpenChange}>
      <DialogContent className="min-w-0 sm:max-w-xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <AlertTriangle size={16} aria-hidden="true" />
            {isPurge ? '彻底删除条目' : '删除条目'}
          </DialogTitle>
          <DialogDescription className="min-w-0 [overflow-wrap:anywhere]">
            {isPurge
              ? `将永久删除“${entry?.title ?? ''}”，此操作无法撤销。`
              : `将“${entry?.title ?? ''}”移入回收站，之后仍可从回收站恢复。`}
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive [overflow-wrap:anywhere]">
          {isPurge ? '条目的 PDF、笔记、解析结果和元数据都会被移除。' : '删除后该条目会从当前列表和已打开标签页中移除。'}
        </div>
        <DialogFooter className="flex-wrap">
          <Button className="shrink-0" disabled={busy} type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button className="shrink-0" disabled={busy} type="button" variant="destructive" onClick={onConfirm}>
            <Trash2 size={14} aria-hidden="true" />
            {isPurge ? '彻底删除' : '移入回收站'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
