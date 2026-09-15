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

import { flattenTagTree, type TagNode } from '../utils/tagTree';

type DeleteTagDialogProps = {
  busy: boolean;
  target: TagNode | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

export function DeleteTagDialog({ busy, target, onConfirm, onOpenChange }: DeleteTagDialogProps) {
  const subtree = target ? flattenTagTree([target]) : [];

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!busy) onOpenChange(open); }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={16} aria-hidden="true" />
            标签移入回收站
          </DialogTitle>
          <DialogDescription>
            将“{target?.path}”以及 {Math.max(0, subtree.length - 1)} 个子标签作为一组移入回收站。
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          受影响的条目会移除这些标签关联。标签描述、标签笔记与阅读进度会保留，可在回收站恢复；论文、条目笔记和批注继续保留。
        </div>
        <DialogFooter>
          <Button disabled={busy} type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={busy} type="button" variant="destructive" onClick={onConfirm}>
            <Trash2 size={14} aria-hidden="true" />
            移入回收站
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
