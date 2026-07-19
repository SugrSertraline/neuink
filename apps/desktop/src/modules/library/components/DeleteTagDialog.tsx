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
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={16} aria-hidden="true" />
            删除标签
          </DialogTitle>
          <DialogDescription>
            将从标签树中删除“{target?.path}”以及 {Math.max(0, subtree.length - 1)} 个子标签。
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          受影响的条目会失去这些标签路径。此操作无法撤销。
        </div>
        <DialogFooter>
          <Button disabled={busy} type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={busy} type="button" variant="destructive" onClick={onConfirm}>
            <Trash2 size={14} aria-hidden="true" />
            删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
