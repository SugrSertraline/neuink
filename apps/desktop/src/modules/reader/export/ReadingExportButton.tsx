import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReadingExportScope } from '@/shared/ipc/readingExportApi';
import { ReadingExportDialog } from './ReadingExportDialog';

export function ReadingExportButton({ entryId, entryTitle = '当前论文', workspaceRoot, scope, label = '导出', scopeLabel = '导出阅读成果', disabled, disabledReason, compact = false, preselectScope = false }: {
  entryId: string;
  entryTitle?: string;
  workspaceRoot: string | null;
  scope: ReadingExportScope;
  label?: string;
  scopeLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  compact?: boolean;
  preselectScope?: boolean;
}) {
  // Capture the clicked scope. Filtering the parent must not silently broaden an open export.
  const [target, setTarget] = useState<{ scope: ReadingExportScope; entryId: string; entryTitle: string; root: string; label: string; preselect: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => { setTarget(null); }, [entryId, workspaceRoot]);
  return <>
    <Button ref={triggerRef} aria-haspopup="dialog" aria-label={scopeLabel} title={!workspaceRoot ? '请先打开资料库' : disabled ? disabledReason ?? scopeLabel : scopeLabel} disabled={disabled || !workspaceRoot} size={compact ? 'icon-xs' : 'xs'} type="button" variant="outline"
      onClick={() => { if (workspaceRoot) setTarget({ scope, entryId, entryTitle, root: workspaceRoot, label: scopeLabel, preselect: preselectScope }); }}>
      <Download aria-hidden="true" size={14} />{compact ? null : label}
    </Button>
    {target && target.entryId === entryId && target.root === workspaceRoot ? <ReadingExportDialog
      entryId={target.entryId} entryTitle={target.entryTitle} workspaceRoot={target.root} scope={target.scope} scopeLabel={target.label}
      preselectScope={target.preselect} open onOpenChange={(open) => { if (!open) { restoreFocus.current = true; setTarget(null); } }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (restoreFocus.current && triggerRef.current?.isConnected) triggerRef.current.focus();
        restoreFocus.current = false;
      }} /> : null}
  </>;
}
