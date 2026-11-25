import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import type { PendingWorkspaceAction } from '../useWorkspaceSelection';
import { formatPathForDisplay } from '../workspaceSelection';

export function WorkspaceSelectionDialog({ pendingWorkspaceAction, workspaceBusy, onCancel, onConfirm }: {
  pendingWorkspaceAction: PendingWorkspaceAction | null;
  workspaceBusy: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const workspaceActionTitle = pendingWorkspaceAction?.intent === 'switch'
    ? '切换工作区'
    : '新建工作区';
  const workspaceActionLabel = pendingWorkspaceAction?.intent === 'switch'
    ? '切换'
    : '新建并打开';

  return (
    <Dialog
      open={Boolean(pendingWorkspaceAction)}
      onOpenChange={(open) => {
        if (!open && !workspaceBusy) {
          onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{workspaceActionTitle}</DialogTitle>
          <DialogDescription>
            {pendingWorkspaceAction?.intent === 'switch'
              ? `将打开包含 ${pendingWorkspaceAction.inspection.entry_count} 个条目的工作区。`
              : '所选位置是空目录，将在这里创建一个新的 Neuink 工作区。'}
          </DialogDescription>
        </DialogHeader>
        <div className="break-all rounded-md border bg-muted/30 px-3 py-2 text-xs">
          {formatPathForDisplay(pendingWorkspaceAction?.inspection.root ?? '')}
        </div>
        <DialogFooter>
          <Button disabled={workspaceBusy} variant="outline" onClick={() => onCancel()}>
            取消
          </Button>
          <Button disabled={workspaceBusy} onClick={() => void onConfirm()}>
            {workspaceBusy ? '处理中…' : workspaceActionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
