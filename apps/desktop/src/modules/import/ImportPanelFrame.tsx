import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ImportPanelFrame({ embedded, busy, title, description, onClose, children }: {
  embedded?: boolean; busy: boolean; title: string; description: string; onClose: () => void; children: ReactNode;
}) {
  if (embedded) return <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <p className="shrink-0 px-4 py-3 text-xs text-muted-foreground">{description}</p>{children}
  </section>;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent layout="bounded" className="max-w-[58rem] sm:max-w-[58rem]" showCloseButton={!busy}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}
    </DialogContent>
  </Dialog>;
}

export function ImportPanelBody({ children }: { children: ReactNode }) {
  return <div className="search-result-scrollbar min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4">{children}</div>;
}

export function ImportPanelFooter({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-col gap-3 border-t border-border p-4">{children}</div>;
}
