import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { decideToolApproval, getToolApprovals, subscribeToolApprovals, type PendingToolApproval } from '../runtime/toolApproval';

/** Compact, keyboard-accessible confirmation. No auto-focus or implicit Enter-to-approve. */
export function ToolApprovalPanel({ root, conversationId, onOpen }: {
  root: string | null; conversationId: string | null; onOpen: (id: string) => void;
}) {
  const requests = useSyncExternalStore(subscribeToolApprovals, getToolApprovals);
  const visible = requests.filter(item => item.root === root);
  if (!visible.length) return null;
  return <section aria-label="待确认操作" className="mb-2 max-h-64 min-w-0 overflow-y-auto rounded-md border border-warning-border bg-warning-surface p-2 text-xs">
    {visible.map(item => item.conversationId === conversationId ? <Approval key={item.id} item={item} /> :
      <Button key={item.id} size="xs" variant="ghost" className="max-w-full whitespace-normal" onClick={() => onOpen(item.conversationId)}>
        另一个对话等待确认，点击查看
      </Button>)}
  </section>;
}

function Approval({ item }: { item: PendingToolApproval }) {
  const input = item.input as Record<string, unknown> | null;
  const appearanceNames: Record<string, string> = { standard: '标准', atelier: '工作室', 'liquid-glass': '液态玻璃' };
  const title = item.toolName === 'create_entry' ? '新增条目' : item.toolName === 'app_set_appearance' ? '修改外观' : '调用外部工具';
  const summary = item.toolName === 'create_entry' ? String(input?.title ?? '')
    : item.toolName === 'app_set_appearance' ? appearanceNames[String(input?.appearance)] ?? String(input?.appearance) : item.toolName;
  return <div className="grid min-w-0 gap-1.5">
    <p role="status" className="font-medium">等待你的确认 · {title}</p>
    <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{summary}</p>
    {item.toolName !== 'create_entry' && item.toolName !== 'app_set_appearance' ? <>
      <p className="text-muted-foreground">外部工具可能修改数据或向外部服务发送以下内容。只批准这一次调用。</p>
      <details><summary className="cursor-pointer">查看完整参数</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{JSON.stringify(item.input, null, 2)}</pre>
      </details>
    </> : <p className="text-muted-foreground">尚未执行。确认后继续；拒绝会停止本次任务。</p>}
    <div className="flex flex-wrap justify-end gap-1">
      <Button size="xs" type="button" variant="ghost" onClick={() => decideToolApproval(item.id, false)}>拒绝并停止</Button>
      <Button size="xs" type="button" onClick={() => decideToolApproval(item.id, true)}>确认执行</Button>
    </div>
  </div>;
}
