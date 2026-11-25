import { Button } from '@/components/ui/button';
import type { useEditRecovery } from '../hooks/useEditRecovery';

export function EditRecoveryNotice({ recovery }: { recovery: ReturnType<typeof useEditRecovery> }) {
  if (!recovery.pending && !recovery.recovered && !recovery.error) return null;
  return <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs">
    <span className={recovery.error ? 'text-destructive' : 'text-muted-foreground'}>{recovery.error ?? (recovery.pending
      ? `发现未保存的本地草稿 · ${new Date(recovery.pending.updatedAt).toLocaleString()}`
      : '已恢复本地草稿，请检查后保存。正式内容尚未覆盖。')}</span>
    {recovery.pending ? <Button size="sm" variant="outline" disabled={recovery.restoring} onClick={() => void recovery.restore()}>{recovery.restoring ? '正在安全恢复…' : '恢复到编辑器'}</Button> : null}
  </div>;
}
