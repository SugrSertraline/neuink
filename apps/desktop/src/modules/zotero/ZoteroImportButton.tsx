import { lazy, Suspense, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ImportDialog = lazy(() => import('./ZoteroImportDialog').then(m => ({ default: m.ZoteroImportDialog })));
export function ZoteroImportButton({ root, disabled, onOpenEntry, scope = 'library', compact = false }: {
  root: string | null; disabled?: boolean; onOpenEntry?: (id: string) => void; scope?: string; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="outline" disabled={disabled || !root} onClick={() => setOpen(true)} aria-label="从 Zotero 导入" title="从 Zotero 导入"
      className={compact ? '@max-[700px]/library-heading:w-8 @max-[700px]/library-heading:px-0' : undefined}>
      <Download size={14} aria-hidden="true" /><span className={compact ? '@max-[700px]/library-heading:hidden' : undefined}>从 Zotero 导入</span>
    </Button>
    {open && root && <Suspense fallback={<span role="status" className="text-xs text-muted-foreground">正在打开…</span>}><ImportDialog key={root} root={root} scope={scope} onOpenEntry={onOpenEntry} onClose={() => setOpen(false)} /></Suspense>}
  </>;
}
