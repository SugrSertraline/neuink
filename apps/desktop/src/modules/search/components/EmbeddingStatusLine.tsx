import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { EmbeddingProviderStatus, SearchMode } from '@/shared/ipc/workspaceApi';

type EmbeddingStatusLineProps = {
  className?: string;
  error?: string | null;
  mode: SearchMode;
  status: EmbeddingProviderStatus | null;
};

export function EmbeddingStatusLine({
  className,
  error,
  mode,
  status
}: EmbeddingStatusLineProps) {
  if (mode !== 'hybrid' && mode !== 'semantic') {
    return null;
  }

  if (error) {
    return (
      <div className={cn('flex items-center gap-1.5 text-[11px] text-destructive', className)}>
        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
        <span>Embedding status unavailable: {error}</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className={cn('flex items-center gap-1.5 text-[11px] text-muted-foreground', className)}>
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
        <span>Checking local embedding resources</span>
      </div>
    );
  }

  if (status.available) {
    return (
      <div className={cn('flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300', className)}>
        <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
        <span>{status.model_name ?? status.provider} ready</span>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300', className)}>
      <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
      <span>{status.message ?? 'Embedding model is not bundled; using keyword fallback.'}</span>
    </div>
  );
}
