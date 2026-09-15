import { Button } from '@/components/ui/button';

export function SegmentRecordsLoadStatus({ error, hasData, loading, onRetry }: {
  error: string | null; hasData: boolean; loading: boolean; onRetry: () => void;
}) {
  if (!error) return null;
  return <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2 text-sm">
    <div className="min-w-0 flex-1 break-words">
      <p className="font-medium text-destructive">{hasData ? '片段记录更新失败' : '片段记录读取失败'}</p>
      <p className="text-xs text-muted-foreground">{hasData ? '仍显示上次读取的内容，当前草稿已保留。' : '未能读取记录，请重试。'} {error}</p>
    </div>
    <Button size="xs" variant="outline" disabled={loading} onClick={onRetry}>{loading ? '重试中…' : '重试'}</Button>
  </div>;
}
