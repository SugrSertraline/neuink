import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  Workflow
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { Job } from '@/shared/ipc/workspaceApi';

export function JobStatusDock({
  activeCount,
  jobs
}: {
  activeCount: number;
  jobs: Job[];
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => summarizeJobs(jobs, activeCount), [activeCount, jobs]);

  if (jobs.length === 0) {
    return null;
  }

  const SummaryIcon = summary.icon;

  return (
    <Popover open={expanded} onOpenChange={setExpanded}>
      <PopoverTrigger asChild>
        <Button
          className="gap-1.5"
          size="sm"
          type="button"
          variant="outline"
        >
          <SummaryIcon
            className={cn('size-3.5', summary.iconClass, activeCount > 0 && 'animate-spin')}
            aria-hidden="true"
          />
          <span>{summary.title}</span>
          <ChevronUp className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[360px] max-w-[calc(100vw-24px)] gap-0 p-0"
        side="top"
        sideOffset={8}
      >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <SummaryIcon
              className={cn('size-4 shrink-0', summary.iconClass, activeCount > 0 && 'animate-spin')}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{summary.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">{summary.description}</div>
            </div>
            <Button
              aria-label="收起任务面板"
              size="icon-xs"
              type="button"
              variant="ghost"
              onClick={() => setExpanded(false)}
            >
              <ChevronDown size={13} aria-hidden="true" />
            </Button>
          </div>
          <div className="grid max-h-[320px] gap-2 overflow-auto px-3 py-2">
            {jobs.map((job) => {
              const JobIcon = jobIcon(job);
              return (
                <div key={job.id} className="rounded-md border bg-muted/20 px-2.5 py-2">
                  <div className="flex items-start gap-2">
                    <JobIcon
                      className={cn(
                        'mt-0.5 size-3.5 shrink-0',
                        jobIconClass(job),
                        job.status === 'processing' && 'animate-spin'
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium">{jobTitle(job)}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {formatProgress(job)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {job.message || job.error || jobStatusLabel(job)}
                      </div>
                      <Progress
                        className="mt-2 h-1.5"
                        indicatorClassName={progressClass(job)}
                        value={Math.max(6, job.progress.percent || 0)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
      </PopoverContent>
    </Popover>
  );
}

function summarizeJobs(jobs: Job[], activeCount: number) {
  const hasFailed = jobs.some((job) => job.status === 'failed');
  const hasCanceled = jobs.some((job) => job.status === 'canceled');
  const latest = jobs[0] ?? null;

  if (activeCount > 0) {
    return {
      description: latest?.message || `有 ${activeCount} 个任务正在运行`,
      icon: Loader2,
      iconClass: 'text-primary',
      title: activeCount === 1 ? '1 个任务进行中' : `${activeCount} 个任务进行中`
    };
  }

  if (hasFailed) {
    return {
      description: latest?.error || latest?.message || '最近任务中有失败项',
      icon: AlertTriangle,
      iconClass: 'text-destructive',
      title: '最近任务有失败'
    };
  }

  if (hasCanceled) {
    return {
      description: latest?.message || '最近任务包含已取消项',
      icon: Clock3,
      iconClass: 'text-warning',
      title: '最近任务已暂停'
    };
  }

  return {
    description: latest?.message || '最近任务已完成',
    icon: CheckCircle2,
    iconClass: 'text-success',
    title: '最近任务'
  };
}

function jobTitle(job: Job) {
  const labelByKind: Record<Job['kind'], string> = {
    index_build: '索引构建',
    llm: 'LLM 任务',
    parser: 'PDF 解析',
    pdf_import: 'PDF 导入',
    translation: '全文翻译',
    vectorize: '向量构建'
  };
  return labelByKind[job.kind] ?? '后台任务';
}

function jobStatusLabel(job: Job) {
  const labelByStatus: Record<Job['status'], string> = {
    canceled: '已取消',
    failed: '失败',
    processing: '进行中',
    queued: '排队中',
    succeeded: '已完成'
  };
  return labelByStatus[job.status];
}

function formatProgress(job: Job) {
  if (job.progress.total > 0) {
    return `${job.progress.current}/${job.progress.total}`;
  }
  return `${Math.round(job.progress.percent || 0)}%`;
}

function jobIcon(job: Job) {
  if (job.status === 'processing' || job.status === 'queued') {
    return Loader2;
  }
  if (job.status === 'failed') {
    return AlertTriangle;
  }
  if (job.status === 'canceled') {
    return Clock3;
  }
  if (job.status === 'succeeded') {
    return CheckCircle2;
  }
  return Workflow;
}

function jobIconClass(job: Job) {
  if (job.status === 'processing' || job.status === 'queued') {
    return 'text-primary';
  }
  if (job.status === 'failed') {
    return 'text-destructive';
  }
  if (job.status === 'canceled') {
    return 'text-warning';
  }
  if (job.status === 'succeeded') {
    return 'text-success';
  }
  return 'text-muted-foreground';
}

function progressClass(job: Job) {
  if (job.status === 'failed') {
    return 'bg-destructive';
  }
  if (job.status === 'canceled') {
    return 'bg-warning';
  }
  if (job.status === 'succeeded') {
    return 'bg-success';
  }
  return 'bg-primary';
}
