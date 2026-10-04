import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock3, Loader2, MessageSquare, Pause, Square } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { Job } from '@/shared/ipc/workspaceApi';
import { useAssistantDebug } from '@/shared/lib/assistantDebug';
import {
  assistantTaskStatusLabels, formatJobProgress, isUnfinishedJob, jobDescription, jobStatusLabel, jobTitle, summarizeTasks,
  type AssistantDockTask,
} from './jobStatusPresentation';

export type { AssistantDockTask } from './jobStatusPresentation';

const EMPTY_ASSISTANT_TASKS: AssistantDockTask[] = [];
type UnfinishedTask = { kind: 'assistant'; task: AssistantDockTask } | { kind: 'job'; job: Job };

function unfinishedTaskPriority(item: UnfinishedTask) {
  const status = item.kind === 'assistant' ? item.task.status : item.job.status;
  return status === 'paused' ? 3 : status === 'queued' ? 2 : status === 'waiting' ? 1 : 0;
}

export function JobStatusDock({ jobs, assistantTasks = EMPTY_ASSISTANT_TASKS, entryTitles, onOpenAssistantTask, onStopAssistantTask, onOpenJob }: {
  /** Accepted for existing callers; displayed counts are derived from actual task states. */
  activeCount?: number;
  jobs: Job[];
  assistantTasks?: AssistantDockTask[];
  entryTitles?: Readonly<Record<string, string>>;
  onOpenAssistantTask?: (id: string) => void;
  onStopAssistantTask?: (id: string) => void;
  onOpenJob?: (job: Job) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showRecent, setShowRecent] = useState(false);
  const recentId = useId();
  const debug = useAssistantDebug();
  const summary = useMemo(() => summarizeTasks(jobs, assistantTasks, debug), [jobs, assistantTasks, debug]);
  const unfinished = useMemo(() => {
    const items: UnfinishedTask[] = [
      ...assistantTasks.map(task => ({ kind: 'assistant' as const, task })),
      ...jobs.filter(isUnfinishedJob).map(job => ({ kind: 'job' as const, job })),
    ];
    return items.sort((left, right) => unfinishedTaskPriority(left) - unfinishedTaskPriority(right));
  }, [jobs, assistantTasks]);
  const recent = useMemo(() => jobs.filter(job => !isUnfinishedJob(job)), [jobs]);

  if (jobs.length === 0 && assistantTasks.length === 0) return null;

  const SummaryIcon = summary.tone === 'running' ? Loader2 : summary.tone === 'waiting' ? Clock3
    : summary.tone === 'failed' ? AlertTriangle : CheckCircle2;
  const iconClass = summary.tone === 'running' ? 'text-primary animate-spin motion-reduce:animate-none'
    : summary.tone === 'waiting' ? 'text-warning' : summary.tone === 'failed' ? 'text-destructive' : 'text-success';

  function openAssistant(id: string) { setExpanded(false); onOpenAssistantTask?.(id); }
  function openJob(job: Job) { setExpanded(false); onOpenJob?.(job); }

  return (
    <Popover open={expanded} onOpenChange={setExpanded}>
      <PopoverTrigger asChild>
        <Button className="max-w-full gap-1.5" size="sm" type="button" variant="outline" aria-label={`实时任务：${summary.title}`}>
          <SummaryIcon className={cn('size-3.5 shrink-0', iconClass)} aria-hidden="true" />
          <span className="truncate">{summary.title}</span>
          <ChevronUp className={cn('size-3.5 shrink-0 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
    <PopoverContent align="end" aria-label="实时任务" viewportAligned data-native-browser-overlay="task-dock"
      className="w-[360px] max-w-[var(--radix-popover-content-available-width)] max-h-[var(--radix-popover-content-available-height)] gap-0 overflow-hidden p-0 data-open:animate-none data-closed:animate-none"
        side="top" sideOffset={8}>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <SummaryIcon className={cn('size-4 shrink-0', iconClass)} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">实时任务</div>
            <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{summary.description}</div>
          </div>
          <Button aria-label="收起任务面板" title="收起任务面板" size="icon-xs" type="button" variant="ghost" onClick={() => setExpanded(false)}>
            <ChevronDown size={13} aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 max-h-[360px] overflow-x-hidden overflow-y-auto overscroll-contain px-3 [scrollbar-gutter:stable]">
          <section aria-label="未完成任务" className="divide-y">
            {unfinished.map(item => item.kind === 'assistant'
              ? <AssistantTaskRow key={`assistant:${item.task.id}`} task={item.task}
                onOpen={onOpenAssistantTask ? openAssistant : undefined} onStop={onStopAssistantTask} />
              : <JobTaskRow key={`job:${item.job.id}`} job={item.job} debug={debug} entryTitles={entryTitles} onOpen={onOpenJob ? openJob : undefined} />)}
          </section>
          {summary.count === 0 && <p className="py-3 text-xs text-muted-foreground">当前没有未完成任务</p>}
          {recent.length > 0 && <div className="border-t py-1">
            <Button type="button" size="sm" variant="ghost" className="w-full justify-between px-0 text-xs"
              aria-expanded={showRecent} aria-controls={recentId} onClick={() => setShowRecent(value => !value)}>
              <span>最近已结束 · {recent.length}</span>
              <ChevronDown className={cn('size-3.5', showRecent && 'rotate-180')} aria-hidden="true" />
            </Button>
            {showRecent && <section id={recentId} aria-label="最近已结束任务" className="divide-y">
              {recent.map(job => <JobTaskRow key={job.id} job={job} debug={debug} entryTitles={entryTitles} onOpen={onOpenJob ? openJob : undefined} />)}
            </section>}
          </div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AssistantTaskRow({ task, onOpen, onStop }: {
  task: AssistantDockTask;
  onOpen?: (id: string) => void;
  onStop?: (id: string) => void;
}) {
  const status = assistantTaskStatusLabels[task.status];
  const Icon = task.status === 'running' ? Loader2 : task.status === 'paused' ? Pause
    : task.status === 'waiting' || task.status === 'queued' ? Clock3 : MessageSquare;
  return (
    <div className="py-2.5" role="group" aria-label={`助手对话：${task.title}`}>
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className={cn('mt-0.5 size-3.5 shrink-0 text-primary', task.status === 'running' && 'animate-spin motion-reduce:animate-none')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
            <span className="font-medium">助手对话</span><span className="text-muted-foreground">{status}</span>
          </div>
          <div className="mt-0.5 truncate text-xs font-medium" title={task.title}>{task.title}</div>
          {task.question && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]" title={task.question}>{task.question}</p>}
          {task.detail && <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{task.detail}</p>}
          {(task.queuedCount ?? 0) > 0 && <p className="mt-1 text-xs text-muted-foreground">{task.queuedCount} 条消息待发送</p>}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {onOpen && <Button size="xs" variant="outline" type="button" disabled={!task.canOpen} onClick={() => onOpen(task.id)}
              aria-label={`返回对话：${task.title}`}>{task.status === 'waiting' ? '前往处理' : '返回对话'}</Button>}
            {onStop && task.status !== 'queued' && task.status !== 'paused' && <Button size="xs" variant="ghost" type="button"
              disabled={!task.canStop || task.status === 'stopping'} onClick={() => onStop(task.id)} aria-label={`停止对话：${task.title}`}>
              <Square size={11} aria-hidden="true" />{task.status === 'stopping' ? '正在停止' : '停止'}
            </Button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function JobTaskRow({ job, debug, entryTitles, onOpen }: {
  job: Job;
  debug: boolean;
  entryTitles?: Readonly<Record<string, string>>;
  onOpen?: (job: Job) => void;
}) {
  const Icon = job.status === 'processing' ? Loader2 : job.status === 'failed' ? AlertTriangle
    : job.status === 'succeeded' ? CheckCircle2 : Clock3;
  const color = job.status === 'failed' ? 'text-destructive' : job.status === 'succeeded' ? 'text-success'
    : job.status === 'paused' || job.status === 'canceled' ? 'text-warning' : 'text-primary';
  const progressColor = job.status === 'failed' ? 'bg-destructive' : job.status === 'succeeded' ? 'bg-success'
    : job.status === 'paused' || job.status === 'canceled' ? 'bg-warning' : 'bg-primary';
  const progress = formatJobProgress(job);
  const title = jobTitle(job);
  const entryTitle = job.scope?.kind === 'entry' ? entryTitles?.[job.scope.entry_id] : undefined;
  return (
    <div className="py-2.5" role="group" aria-label={title}>
      <div className="flex items-start gap-2">
        <Icon className={cn('mt-0.5 size-3.5 shrink-0', color, job.status === 'processing' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
            <span className="text-xs font-medium">{title}</span>
            <span className="text-[11px] text-muted-foreground">{jobStatusLabel(job)}{progress ? ` · ${progress}` : ''}</span>
          </div>
          {entryTitle && <div className="mt-0.5 truncate text-xs font-medium" title={entryTitle}>{entryTitle}</div>}
          <div className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground [overflow-wrap:anywhere]">{jobDescription(job, debug)}</div>
          {progress && <Progress className="mt-2 h-1.5" aria-label={`${title}进度`} indicatorClassName={progressColor}
            value={Math.max(0, Math.min(100, job.progress.percent || 0))} />}
          {onOpen && job.scope?.kind === 'entry' && <Button className="mt-1.5" size="xs" type="button" variant="outline"
            onClick={() => onOpen(job)} aria-label={`查看任务：${title}`}>查看任务</Button>}
        </div>
      </div>
    </div>
  );
}
