import { ArrowDown, ArrowUp, ArrowUpToLine, X } from 'lucide-react';
import { useState } from 'react';
import type { EntryMeta } from '@/shared/types/domain';
import { Button } from '@/components/ui/button';
import type { usePdfParseQueue } from '@/shared/hooks/usePdfParseQueue';

export function PdfParseQueuePanel({ controller, onOpen, onRetry }: {
  controller: ReturnType<typeof usePdfParseQueue>; onOpen: (id: string) => void; onRetry: (id: string) => Promise<unknown>;
}) {
  const { queue, error, loading, busy, move, refresh, configured } = controller;
  return <div className="mt-2 min-w-0 border-t border-border pt-2 text-xs" aria-label="PDF 解析队列">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-1 px-1 font-medium">
      <span>解析队列 · {queue.active.length} 进行中 / {queue.waiting.length} 等待</span>
      <Button variant="ghost" size="xs" onClick={refresh}>刷新</Button>
    </div>
    {!configured && <p className="px-1 py-1 text-muted-foreground">请先在设置中填写解析服务地址，队列会在配置后继续。</p>}
    {loading && <p className="px-1 py-1 text-muted-foreground" role="status">正在读取队列…</p>}
    {error && <p className="break-words px-1 py-1 text-destructive" role="alert">{error}</p>}
    {queue.active.map(entry => <div key={entry.id} className="border-b border-border/50 px-1 py-2">
      <button className="w-full truncate text-left text-sm hover:text-primary focus-visible:outline-ring" title={entry.title} onClick={() => onOpen(entry.id)}>{entry.title}</button>
      <p className="text-muted-foreground">{entry.pdf?.parse.status === 'uploading' ? '正在上传' : entry.pdf?.parse.message?.startsWith('queued') ? '解析服务排队中' : '正在解析'}</p>
      {entry.pdf?.parse.message && <p className="break-words text-muted-foreground">{entry.pdf.parse.message}</p>}
    </div>)}
    <ol aria-label="等待解析的任务">
      {queue.waiting.map((entry, index) => <li key={entry.id} className="border-b border-border/50 px-1 py-2">
        <button className="w-full truncate text-left text-sm hover:text-primary focus-visible:outline-ring" title={entry.title} onClick={() => onOpen(entry.id)}>{index + 1}. {entry.title}</button>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="mr-auto text-muted-foreground">等待解析</span>
          {([{ action: 'first', label: '置顶', Icon: ArrowUpToLine, disabled: index === 0 },
            { action: 'up', label: '上移', Icon: ArrowUp, disabled: index === 0 },
            { action: 'down', label: '下移', Icon: ArrowDown, disabled: index === queue.waiting.length - 1 },
            { action: 'remove', label: '移出队列', Icon: X, disabled: false }] as const).map(({ action, label, Icon, disabled }) =>
              <Button key={action} variant="ghost" size="icon-xs" aria-label={`${label}：${entry.title}`} title={label} disabled={busy || disabled} onClick={() => void move(entry.id, action)}><Icon size={13} /></Button>)}
        </div>
      </li>)}
    </ol>
    {!loading && !error && !queue.waiting.length && !queue.active.length && <p className="px-1 py-2 text-muted-foreground">没有等待或正在解析的任务</p>}
    {queue.failed.length > 0 && <details className="px-1 py-2"><summary className="cursor-pointer text-destructive">解析失败 · {queue.failed.length}</summary>
      {queue.failed.map(entry => <FailedRow key={entry.id} entry={entry} configured={configured} onOpen={onOpen} onRetry={onRetry} />)}
    </details>}
  </div>;
}

function FailedRow({ entry, configured, onOpen, onRetry }: { entry: EntryMeta; configured: boolean; onOpen: (id: string) => void; onRetry: (id: string) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="border-b border-border/50 py-2">
    <button className="w-full truncate text-left text-sm" title={entry.title} onClick={() => onOpen(entry.id)}>{entry.title}</button>
    <p className="break-words text-muted-foreground">{entry.pdf?.parse.message || '解析失败'}</p>
    {error && <p role="alert" className="break-words text-destructive">{error}</p>}
    <Button variant="outline" size="xs" disabled={busy || !configured} onClick={async () => {
      setBusy(true); setError('');
      try { await onRetry(entry.id); } catch (e) { setError(String(e)); } finally { setBusy(false); }
    }}>{busy ? '正在加入…' : '重新加入队列'}</Button>
  </div>;
}
