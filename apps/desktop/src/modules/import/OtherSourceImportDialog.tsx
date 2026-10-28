import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { OtherSourceImportPage } from './OtherSourceImportPage';

/** Compatibility for callers that still present imports in a dialog. */
export function OtherSourceImportDialog({ root, onClose, onImported, onOpenEntry }: {
  root: string; onClose: () => void; onImported?: () => Promise<void> | void; onOpenEntry?: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent layout="bounded" className="h-[85vh] max-w-[70rem] sm:max-w-[70rem]" showCloseButton={!busy}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle className="sr-only">从其他来源导入</DialogTitle><DialogDescription className="sr-only">选择来源并预览要导入的论文。</DialogDescription>
      <OtherSourceImportPage root={root} onImported={onImported} onOpenEntry={onOpenEntry} onBusyChange={setBusy} />
    </DialogContent>
  </Dialog>;
}
