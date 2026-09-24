import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { listAgentExecutions, type AgentExecutionRecord } from '@/shared/ipc/agentExecutionApi';

/** State belongs to the durable runtime; this component only discovers and requests continuation. */
export function ExecutionRecovery({ root, conversationId, busy, onResume }: {
  root: string | null;
  conversationId?: string;
  busy: boolean;
  onResume: (id: string) => void;
}) {
  const [records, setRecords] = useState<AgentExecutionRecord[]>([]);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setRecords([]);
    setFailed(false);
    if (!root || !conversationId || busy) return;
    void listAgentExecutions(root, conversationId).then(value => {
      if (!cancelled) setRecords(value);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [root, conversationId, busy, retry]);
  if (busy || (!failed && records.length === 0)) return null;
  return <div className="border-t px-2 py-1 text-xs" aria-live="polite">
    {failed ? <div className="flex items-center gap-2 text-destructive">
      未能读取未完成任务
      <Button size="xs" variant="ghost" onClick={() => setRetry(value => value + 1)}>重试</Button>
    </div> : records.slice(0, 3).map(record => <div key={record.id} className="flex min-w-0 items-center gap-2 py-1">
      <span className="min-w-0 flex-1 truncate" title={String(record.payload.question ?? '')}>
        {record.status === 'cancelled' ? '已停止' : record.status === 'failed' ? '执行未完成' : '任务中断或结果待交付'}：{String(record.payload.question ?? '')}
      </span>
      <Button size="xs" variant="outline" onClick={() => onResume(record.id)}>继续任务</Button>
    </div>)}
  </div>;
}
