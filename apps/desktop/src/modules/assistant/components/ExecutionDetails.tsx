import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { DisclosureIcon } from '@/components/ui/disclosure-icon';
import type { AssistantToolTraceEvent } from '@/shared/ipc/assistantApi';
import type { AssistantAgentRun } from '@/shared/types/assistant';
import { resolveAssistantRunStatus } from './AssistantRunStatus';

/** Each message owns its disclosure; only the expanded details own an inner scroll area. */
export function ExecutionDetails({ children, streaming, hasAnswer, run, events, awaitingApproval = false }: {
  awaitingApproval?: boolean;
  children: ReactNode;
  streaming: boolean;
  hasAnswer: boolean;
  run?: AssistantAgentRun | null;
  events: AssistantToolTraceEvent[];
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const errors = events.filter(event => event.status === 'error');
  const failed = run?.status === 'failed' || errors.length > 0;
  const running = [...events].reverse().find(event => event.status === 'running');
  const awaitingInput = streaming && running?.toolName === 'ask_user';
  const label = awaitingInput ? '等待你的选择' : awaitingApproval ? '等待你的确认' : streaming
    ? running?.toolName === 'agent.memory' ? '正在整理记录' : resolveAssistantRunStatus({
      busy: true, error: null, queued: false, streaming: hasAnswer, toolEvents: events,
    }).label
    : run?.status === 'canceled' ? '已停止' : failed ? '执行有异常' : '执行详情';
  const latestError = errors[errors.length - 1]?.error
    ?? run?.nodes.find(node => node.status === 'failed')?.error;
  return <div className="mb-1 min-w-0 text-[11px] text-muted-foreground">
    <Button
      type="button" size="xs" variant="ghost"
      className="h-6 max-w-full justify-start gap-1 px-1 font-normal"
      aria-label={expanded ? '收起执行详情' : '展开执行详情'}
      aria-expanded={expanded} aria-controls={detailsId}
      onClick={() => setExpanded(value => !value)}
    >
      <DisclosureIcon open={expanded} size={12} />
      {streaming && !awaitingApproval && !awaitingInput ? <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-0.5" data-thinking-animation="true">
        {[0, 1, 2].map(index => <span key={index} className="size-1 rounded-full bg-current motion-safe:animate-pulse motion-reduce:animate-none" style={{ animationDelay: `${index * 200}ms` }} />)}
      </span> : null}
      <span role="status" className={failed && !streaming ? 'truncate text-destructive' : 'truncate'}>{label}</span>
      {!streaming && run?.durationMs !== undefined
        ? <span className="shrink-0 tabular-nums">· {(run.durationMs / 1000).toFixed(1)} 秒</span> : null}
    </Button>
    {!streaming && latestError ? <p className="line-clamp-2 break-words text-destructive">{latestError}</p> : null}
    <div id={detailsId} hidden={!expanded}>
      {expanded ? <div className="my-1 max-h-64 overflow-y-auto overscroll-contain border-l pl-2 pr-1 break-words">
        {children}
      </div> : null}
    </div>
  </div>;
}
