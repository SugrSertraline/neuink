import { AlertTriangle, CheckCircle2, Database, HardDrive, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import type {
  SearchIndexBuildStatus,
  SearchIndexStatus,
  SearchMode
} from '@/shared/ipc/workspaceApi';

type SearchIndexStatusLineProps = {
  className?: string;
  buildStatus?: SearchIndexBuildStatus | null;
  error?: string | null;
  mode: SearchMode;
  status: SearchIndexStatus | null;
};

export function SearchIndexStatusLine({
  buildStatus,
  className,
  error,
  mode,
  status
}: SearchIndexStatusLineProps) {
  if (mode !== 'hybrid' && mode !== 'semantic') {
    return null;
  }

  if (buildStatus?.state === 'queued' || buildStatus?.state === 'running') {
    const progress = buildStatus.total > 0
      ? Math.round((buildStatus.completed / buildStatus.total) * 100)
      : 0;
    return (
      <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300', className)}>
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
        <span className="min-w-0 truncate">
          {buildStatus.message}{buildStatus.total > 0 ? ` · ${progress}%` : ''}
        </span>
      </div>
    );
  }

  if (buildStatus?.state === 'failed') {
    return (
      <div className={cn('flex min-w-0 items-start gap-1.5 text-[11px] text-destructive', className)}>
        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words leading-4">
          {buildStatus.error ?? buildStatus.message}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex min-w-0 items-start gap-1.5 text-[11px] text-destructive', className)}>
        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words leading-4">索引状态不可用：{error}</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground', className)}>
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
        <span className="min-w-0 truncate">检查索引缓存</span>
      </div>
    );
  }

  if (status.semantic_document_count === 0) {
    return (
      <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground', className)}>
        <Database className="size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{status.message}</span>
      </div>
    );
  }

  if (status.semantic_status === 'ready_memory') {
    return (
      <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300', className)}>
        <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">向量已就绪 · {status.semantic_document_count}</span>
      </div>
    );
  }

  if (status.semantic_status === 'ready_disk') {
    return (
      <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px] text-sky-700 dark:text-sky-300', className)}>
        <HardDrive className="size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">
          磁盘缓存 · {status.semantic_disk_cache_record_count ?? status.semantic_document_count}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300', className)}>
      <Database className="size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{status.message}</span>
    </div>
  );
}
