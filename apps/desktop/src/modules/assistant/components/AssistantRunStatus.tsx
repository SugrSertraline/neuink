import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';

export function AssistantRunStatus({
  busy,
  error,
  queued,
  streaming,
  toolEvents
}: {
  busy: boolean;
  error: string | null;
  queued: boolean;
  streaming: boolean;
  toolEvents: AssistantToolTraceEvent[];
}) {
  const status = resolveAssistantRunStatus({ busy, error, queued, streaming, toolEvents });
  const Icon = status.tone === 'danger'
    ? AlertCircle
    : status.active
      ? Loader2
      : CheckCircle2;
  return (
    <span
      className="inline-flex max-w-32 items-center gap-1 rounded-full border bg-background/80 px-2 py-0.5 text-[10px] text-muted-foreground"
      role="status"
      title={status.label}
    >
      <Icon
        aria-hidden="true"
        className={status.active ? 'animate-spin text-primary' : status.tone === 'danger' ? 'text-destructive' : ''}
        size={11}
      />
      <span className="truncate">{status.label}</span>
    </span>
  );
}

export function resolveAssistantRunStatus({
  busy,
  error,
  queued,
  streaming,
  toolEvents
}: {
  busy: boolean;
  error: string | null;
  queued: boolean;
  streaming: boolean;
  toolEvents: AssistantToolTraceEvent[];
}) {
  if (error && !busy) return { active: false, label: '运行失败', tone: 'danger' as const };
  if (queued) return { active: true, label: '已排队', tone: 'normal' as const };
  if (!busy) return { active: false, label: '就绪', tone: 'normal' as const };
  const running = [...toolEvents].reverse().find((event) => event.status === 'running');
  const name = running?.toolName ?? '';
  if (name.includes('verifier')) return active('正在验证');
  if (name.includes('search')) return active('正在检索');
  if (name.includes('hydrate') || name.includes('read')) return active('正在读取');
  if (name.includes('planner') || name.includes('subagent')) return active('正在规划');
  if (streaming) return active('正在回答');
  return active('正在思考');
}

function active(label: string) {
  return { active: true, label, tone: 'normal' as const };
}
