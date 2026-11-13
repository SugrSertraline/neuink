import { Loader2 } from 'lucide-react';

/** A stable presentation across metadata, bytes and document preparation; never claims measured progress. */
export function ReaderLoading() {
  return <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-40 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
    <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
    <span>正在打开条目…</span>
  </div>;
}
