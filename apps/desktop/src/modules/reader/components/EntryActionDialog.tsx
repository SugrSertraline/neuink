import { AlertTriangle, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

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
import {
  getEntryDeletionImpact,
  type EntryDeletionImpact
} from '@/shared/ipc/workspaceApi';

type EntryAction = 'move-to-trash' | 'purge';

type EntryActionDialogProps = {
  action: EntryAction;
  busy: boolean;
  entry: LibraryEntry | null;
  workspaceRoot: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

export function EntryActionDialog({
  action,
  busy,
  entry,
  workspaceRoot,
  onConfirm,
  onOpenChange
}: EntryActionDialogProps) {
  const isPurge = action === 'purge';
  const [impact, setImpact] = useState<EntryDeletionImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  useEffect(() => {
    if (!entry || isPurge || !workspaceRoot) {
      setImpact(null);
      setImpactError(null);
      setLoadingImpact(false);
      return;
    }
    let active = true;
    setImpact(null);
    setImpactError(null);
    setLoadingImpact(true);
    void getEntryDeletionImpact(workspaceRoot, entry.id)
      .then((nextImpact) => {
        if (active) setImpact(nextImpact);
      })
      .catch((caught) => {
        if (active) setImpactError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (active) setLoadingImpact(false);
      });
    return () => {
      active = false;
    };
  }, [entry, isPurge, workspaceRoot]);

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
          {isPurge ? '条目的 PDF、笔记、解析结果和元数据都会被永久移除。' : (
            loadingImpact ? '正在检查 PDF、解析结果、笔记、批注与其他条目的来源链接…' :
            impact ? (
              <div className="grid gap-1">
                <div>PDF：{impact.has_pdf ? '1 个' : '无'}；解析块：{impact.parsed_block_count}；笔记：{impact.note_count}；批注：{impact.annotation_count}。</div>
                <div>其他笔记中有 {impact.incoming_source_link_count} 个来源链接指向此条目；移入回收站后这些笔记保留，但预览将在恢复前不可用。</div>
              </div>
            ) : impactError ? `无法读取影响统计：${impactError}` : '删除后该条目会从当前列表和已打开标签页中移除。'
          )}
        </div>
        <DialogFooter className="flex-wrap">
          <Button className="shrink-0" disabled={busy} type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button className="shrink-0" disabled={busy || (!isPurge && loadingImpact)} type="button" variant="destructive" onClick={onConfirm}>
            <Trash2 size={14} aria-hidden="true" />
            {isPurge ? '彻底删除' : '移入回收站'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
