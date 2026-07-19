import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';

export function UnsavedSegmentChangesDialog({
  busy,
  open,
  onCancel,
  onDiscard,
  onSave
}: {
  busy: boolean;
  open: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && !busy) onCancel();
    }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>保存修改后再关闭？</DialogTitle>
          <DialogDescription>
            当前片段笔记或批注包含未保存的修改。请选择保存、放弃修改或继续编辑。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-wrap">
          <Button disabled={busy} type="button" variant="outline" onClick={onCancel}>
            继续编辑
          </Button>
          <Button disabled={busy} type="button" variant="destructive" onClick={onDiscard}>
            不保存并关闭
          </Button>
          <Button disabled={busy} type="button" onClick={onSave}>
            {busy ? '保存中…' : '保存并关闭'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
