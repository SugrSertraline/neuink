import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Languages,
  Loader2
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { EntryTranslation, Job } from '@/shared/ipc/workspaceApi';

type TranslationTaskStatusProps = {
  busy: boolean;
  canExport?: boolean;
  detail?: string | null;
  jobStatus?: Job['status'] | null;
  message?: string | null;
  onExport?: (() => void) | null;
  onPause?: (() => void) | null;
  onRetryFailed?: (() => void) | null;
  translation: EntryTranslation | null;
};

export function TranslationTaskStatus({
  busy,
  canExport = false,
  detail,
  jobStatus,
  message,
  onExport,
  onPause,
  onRetryFailed,
  translation
}: TranslationTaskStatusProps) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(
    () => summarizeTranslationTask({ busy, jobStatus, message, translation }),
    [busy, jobStatus, message, translation]
  );

  if (!summary.visible) {
    return null;
  }

  const Icon = summary.icon;

  if (!expanded) {
    return (
      <div className="pointer-events-none absolute bottom-3 right-3 z-50 max-w-[calc(100%-24px)]">
        <button
          aria-expanded={expanded}
          className="pointer-events-auto flex h-8 max-w-[360px] items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2.5 text-xs text-zinc-50 shadow-lg outline-none transition hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-ring"
          type="button"
          onClick={() => setExpanded(true)}
        >
          <Icon
            className={busy ? 'size-3.5 shrink-0 animate-spin' : 'size-3.5 shrink-0'}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">{summary.title}</span>
          <span className="shrink-0 text-zinc-300">{summary.progressLabel}</span>
          <ChevronUp className="size-3.5 shrink-0 text-zinc-300" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-50 w-[360px] max-w-[calc(100%-24px)]">
      <div className="pointer-events-auto rounded-md border bg-white text-xs text-foreground shadow-xl">
        <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
          <Icon
            className={busy ? 'size-4 shrink-0 animate-spin text-primary' : summary.iconClass}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{summary.title}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {detail || summary.description}
            </div>
          </div>
          <Button
            aria-label="收起翻译任务进度"
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={() => setExpanded(false)}
          >
            <ChevronDown size={13} aria-hidden="true" />
          </Button>
        </div>

        <div className="grid gap-2 px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span>{summary.phaseLabel}</span>
            <span>{summary.progressLabel}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={summary.progressClass}
              style={{ width: `${summary.percent}%` }}
            />
          </div>
          {translation?.progress.failed ? (
            <div className="text-[11px] text-warning">
              {translation.progress.failed} 个片段翻译失败，可稍后继续翻译。
            </div>
          ) : null}
          {busy || onPause || onRetryFailed || (canExport && onExport) ? (
            <div className="flex flex-wrap justify-end gap-2">
              {!busy && onRetryFailed && translation?.progress.failed ? (
                <Button size="sm" type="button" variant="outline" onClick={onRetryFailed}>
                  重试失败部分
                </Button>
              ) : null}
              {!busy && canExport && onExport ? (
                <Button size="sm" type="button" variant="outline" onClick={onExport}>
                  导出笔记
                </Button>
              ) : null}
              {busy && onPause ? (
                <Button size="sm" type="button" variant="outline" onClick={onPause}>
                  暂停翻译
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function summarizeTranslationTask({
  busy,
  jobStatus,
  message,
  translation
}: {
  busy: boolean;
  jobStatus?: Job['status'] | null;
  message?: string | null;
  translation: EntryTranslation | null;
}) {
  const progress = translation?.progress;
  const hasTranslation = Boolean(
    translation?.segments.some((segment) => segment.status === 'translated' && segment.translated_text)
  );
  const total = progress?.total ?? 0;
  const completed = progress
    ? progress.translated + progress.skipped + progress.failed
    : 0;
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : busy ? 8 : 100;
  const status = translation?.status;
  const hasPersistentStatus = status === 'partial' || status === 'failed' || status === 'running';
  const visible = busy || Boolean(message) || hasPersistentStatus || hasTranslation;
  const title = message || statusTitle(status) || '全文翻译';
  const progressLabel = total > 0 ? `${completed}/${total}` : busy ? '进行中' : '已完成';

  if (busy || status === 'running') {
    return {
      description: '正在处理全文翻译任务',
      icon: Loader2,
      iconClass: 'size-4 shrink-0 text-primary',
      percent,
      phaseLabel: '进行中',
      progressClass: 'h-full rounded-full bg-primary transition-[width] duration-300',
      progressLabel,
      title,
      visible
    };
  }

  if (jobStatus === 'canceled') {
    return {
      description: translation?.error || '已保留当前进度，可稍后继续翻译。',
      icon: AlertTriangle,
      iconClass: 'size-4 shrink-0 text-warning',
      percent,
      phaseLabel: '已暂停',
      progressClass: 'h-full rounded-full bg-warning transition-[width] duration-300',
      progressLabel,
      title,
      visible
    };
  }

  if (status === 'failed' || status === 'partial') {
    return {
      description: translation?.error || '翻译尚未完全完成。',
      icon: AlertTriangle,
      iconClass: 'size-4 shrink-0 text-warning',
      percent,
      phaseLabel: status === 'failed' ? '失败' : '部分完成',
      progressClass: 'h-full rounded-full bg-warning transition-[width] duration-300',
      progressLabel,
      title,
      visible
    };
  }

  if (status === 'succeeded' || message) {
    return {
      description: '已保存全文翻译结果。',
      icon: CheckCircle2,
      iconClass: 'size-4 shrink-0 text-success',
      percent,
      phaseLabel: '已完成',
      progressClass: 'h-full rounded-full bg-success transition-[width] duration-300',
      progressLabel,
      title,
      visible
    };
  }

  return {
    description: '等待翻译任务开始。',
    icon: Languages,
    iconClass: 'size-4 shrink-0 text-muted-foreground',
    percent,
    phaseLabel: '等待中',
    progressClass: 'h-full rounded-full bg-muted-foreground transition-[width] duration-300',
    progressLabel,
    title,
    visible
  };
}

function statusTitle(status: EntryTranslation['status'] | undefined) {
  if (status === 'running') {
    return '正在翻译全文';
  }
  if (status === 'partial') {
    return '翻译部分完成';
  }
  if (status === 'failed') {
    return '翻译失败';
  }
  if (status === 'succeeded') {
    return '翻译完成';
  }
  return null;
}
