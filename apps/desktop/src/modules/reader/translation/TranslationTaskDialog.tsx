import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, Eye, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Progress } from '@/components/ui/progress';
import type { EntryTranslation, JobProgress, TranslatedSegmentStatus } from '@/shared/ipc/workspaceApi';
import type { SegmentType, SourceSegment } from '@/shared/types/domain';
import { ReadingExportButton } from '../export/ReadingExportButton';

type Filter = 'all' | 'pending' | 'translated' | 'failed';
type RunMode = 'pending' | 'retry' | 'force';

const ALL_SEGMENT_TYPES: SegmentType[] = [
  'paragraph',
  'heading',
  'table',
  'math',
  'figure',
  'code',
  'list',
  'page_header',
  'page_footer',
  'page_number',
  'aside_text',
  'page_footnote'
];

export function TranslationTaskDialog({
  open,
  segments,
  translation,
  busy = false,
  message,
  progress,
  onOpenChange,
  onTranslate,
  exportContext
}: {
  open: boolean;
  segments: SourceSegment[];
  translation: EntryTranslation | null;
  busy?: boolean;
  detail?: string | null;
  message?: string | null;
  progress?: JobProgress | null;
  onOpenChange: (open: boolean) => void;
  onTranslate: (segments: SourceSegment[], mode: RunMode) => Promise<void>;
  exportContext?: { entryId: string; entryTitle: string; workspaceRoot: string | null };
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedTypes, setSelectedTypes] = useState<Set<SegmentType>>(new Set());
  const initializedForOpenRef = useRef(false);
  const statuses = useMemo(
    () => new Map((translation?.segments ?? []).map((segment) => [segment.segment_uid, segment])),
    [translation]
  );
  const rows = useMemo(
    () => segments.map((segment) => {
      const translated = statuses.get(segment.uid);
      return {
        segment,
        status: translated?.status ?? 'pending',
        error: translated?.status === 'skipped' ? null : translated?.error ?? null
      };
    }),
    [segments, statuses]
  );
  const visible = rows.filter(
    (row) =>
      selectedTypes.has(row.segment.segment_type) &&
      (filter === 'all' || (filter === 'pending' ? row.status === 'pending' || row.status === 'skipped' : row.status === filter))
  );
  const counts = rows.reduce<Record<Filter, number>>((current, row) => {
    current.all += 1;
    if (row.status === 'translated') current.translated += 1;
    else if (row.status === 'failed') current.failed += 1;
    else current.pending += 1;
    return current;
  }, { all: 0, pending: 0, translated: 0, failed: 0 });
  const completedCount = counts.translated;
  const displayedCompleted = busy && progress ? progress.current : completedCount;
  const displayedTotal = busy && progress ? progress.total : rows.length;
  const runningMessage = busy
    ? message?.match(/已接收\s*(\d+)\s*字/)
      ? `正在翻译 · 已接收 ${message.match(/已接收\s*(\d+)\s*字/)?.[1]} 字`
      : '正在翻译'
    : message;
  const progressValue = busy && progress
    ? progress.percent
    : rows.length > 0
      ? (completedCount / rows.length) * 100
      : 0;
  const actionableVisible = visible.filter((row) => isActionable(row.status));
  const allVisibleSelected = actionableVisible.length > 0 && actionableVisible.every((row) => selected.has(row.segment.uid));

  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      return;
    }
    if (initializedForOpenRef.current || rows.length === 0) return;
    initializedForOpenRef.current = true;
    setSelectedTypes(new Set(ALL_SEGMENT_TYPES));
    setSelected(new Set());
  }, [open, rows]);

  const toggleType = (segmentType: SegmentType) => {
    const enabled = selectedTypes.has(segmentType);
    setSelectedTypes((current) => {
      const next = new Set(current);
      if (enabled) next.delete(segmentType);
      else next.add(segmentType);
      return next;
    });
    setSelected((current) => {
      const next = new Set(current);
      for (const row of rows) {
        if (row.segment.segment_type !== segmentType) continue;
        if (enabled) next.delete(row.segment.uid);
      }
      return next;
    });
  };

  const run = (mode: RunMode) => {
    const candidates = rows.filter((row) => {
      if (!selected.has(row.segment.uid) || row.status === 'skipped') return false;
      if (mode === 'force') return true;
      if (mode === 'retry') return row.status === 'failed';
      return isActionable(row.status);
    });
    if (candidates.length === 0) return;
    void onTranslate(candidates.map((row) => row.segment), mode);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,64rem)] max-w-none gap-3 sm:max-w-none">
        <DialogHeader>
          <DialogTitle>翻译任务</DialogTitle>
          <DialogDescription>
            选择需要英译中的区域类型或具体 Block。行内公式与行间公式将保持原格式。
          </DialogDescription>
        </DialogHeader>

        <div
          aria-live="polite"
          className="grid gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2"
          role="status"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock3 aria-hidden="true" className="shrink-0 text-primary" size={15} />
            <span>
              {busy
                ? `${runningMessage || '正在翻译'} · ${displayedCompleted}/${displayedTotal}`
                : `翻译进度：已完成 ${completedCount}/${rows.length}`}
            </span>
          </div>
          <Progress value={progressValue} />
        </div>

        <div className="grid gap-2 rounded-md border p-2">
          <div className="flex flex-wrap items-center gap-1.5 border-b pb-2">
            <span className="mr-1 text-xs font-semibold text-muted-foreground">翻译状态</span>
            {(['all', 'pending', 'translated', 'failed'] as Filter[]).map((value) => (
              <Button key={value} size="xs" type="button" variant={filter === value ? 'secondary' : 'outline'} onClick={() => setFilter(value)}>
                {filterLabel(value)} {counts[value]}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-muted-foreground">翻译内容类型</span>
            <div className="flex flex-wrap gap-1.5">
              {ALL_SEGMENT_TYPES.map((segmentType) => {
                const enabled = selectedTypes.has(segmentType);
                const typeCount = rows.filter((row) => row.segment.segment_type === segmentType).length;
                return (
                  <Button
                    aria-pressed={enabled}
                    disabled={busy || typeCount === 0}
                    key={segmentType}
                    size="xs"
                    type="button"
                    variant={enabled ? 'secondary' : 'outline'}
                    onClick={() => toggleType(segmentType)}
                  >
                    {segmentTypeLabel(segmentType)} {typeCount}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="max-h-[min(48vh,28rem)] overflow-auto rounded-md border">
          {visible.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              当前筛选条件下没有 Block。可切换状态或重新选择内容类型。
            </div>
          ) : (
            <div className="min-w-[44rem] text-sm" role="table">
              <div className="grid grid-cols-[2.5rem_5rem_7rem_minmax(0,1fr)_12rem] items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-semibold text-muted-foreground" role="row">
                <input
                  aria-label="全选当前列表"
                  checked={allVisibleSelected}
                  disabled={busy || actionableVisible.length === 0}
                  type="checkbox"
                  onChange={() => setSelected((current) => {
                    const next = new Set(current);
                    if (allVisibleSelected) actionableVisible.forEach((row) => next.delete(row.segment.uid));
                    else actionableVisible.forEach((row) => next.add(row.segment.uid));
                    return next;
                  })}
                />
                <span role="columnheader">页码</span>
                <span role="columnheader">类型</span>
                <span role="columnheader">内容</span>
                <span className="text-right" role="columnheader">状态 / 操作</span>
              </div>
              {visible.map(({ segment, status, error }) => {
                const text = (segment.markdown ?? segment.text).trim();
                return (
                  <div className="grid grid-cols-[2.5rem_5rem_7rem_minmax(0,1fr)_12rem] items-center gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50" key={segment.uid} role="row">
                    <input
                      aria-label={`选择第 ${segment.page_idx + 1} 页 ${segmentTypeLabel(segment.segment_type)}`}
                      checked={selected.has(segment.uid)}
                      disabled={busy || status === 'skipped'}
                      type="checkbox"
                      onChange={() => setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(segment.uid)) next.delete(segment.uid); else next.add(segment.uid);
                        return next;
                      })}
                    />
                    <span role="cell">第 {segment.page_idx + 1} 页</span>
                    <span className="truncate text-muted-foreground" role="cell" title={segmentTypeLabel(segment.segment_type)}>{segmentTypeLabel(segment.segment_type)}</span>
                    <span className="flex min-w-0 items-center gap-1" role="cell">
                      <span className="min-w-0 flex-1 truncate" title={text || undefined}>{text || '无文本'}</span>
                      <SourcePreview segment={segment} />
                    </span>
                    <span className="flex items-center justify-end gap-1.5" role="cell">
                      <Status status={status} />
                      {status === 'failed' ? (
                        <Button
                          aria-label={`重试第 ${segment.page_idx + 1} 页`}
                          disabled={busy}
                          size="icon-xs"
                          title="重试此 Block"
                          type="button"
                          variant="ghost"
                          onClick={() => void onTranslate([segment], 'retry')}
                        >
                          <RotateCcw aria-hidden="true" size={13} />
                        </Button>
                      ) : null}
                      {error ? <span className="sr-only">翻译失败，可重试</span> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          {exportContext ? <ReadingExportButton {...exportContext} disabled={busy || completedCount === 0}
            scope={{ kinds: ['translation'] }} label="导出已保存译文" scopeLabel="导出已保存译文" /> : null}
          <Button disabled={busy || selected.size === 0} size="sm" type="button" variant="outline" onClick={() => run('force')}>
            重新翻译选中
          </Button>
          <Button disabled={busy || selected.size === 0} size="sm" type="button" onClick={() => run('pending')}>
            翻译选中（{selected.size}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourcePreview({ segment }: { segment: SourceSegment }) {
  const text = (segment.markdown ?? segment.text).trim();

  return (
    <HoverCard>
      <HoverCardTrigger asChild openOnClick>
        <Button
          aria-label="查看原文"
          size="icon-xs"
          type="button"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Eye aria-hidden="true" size={14} />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        align="end"
        className="w-[32rem]"
        side="left"
      >
        <div className="mb-2 text-xs font-medium text-muted-foreground">原文 · 第 {segment.page_idx + 1} 页</div>
        <div className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-sm leading-relaxed">
          {text || '该 Block 没有可显示的原文。'}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function Status({ status }: { status: TranslatedSegmentStatus }) {
  if (status === 'translated') return <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 size={13} />已翻译</span>;
  if (status === 'failed') return <span className="flex items-center gap-1 text-xs text-destructive"><CircleAlert size={13} />失败</span>;
  if (status === 'skipped') return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 size={13} />已跳过</span>;
  return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 size={13} />待翻译</span>;
}

function actionableRows<T extends { status: TranslatedSegmentStatus }>(rows: T[]) {
  return rows.filter((row) => isActionable(row.status));
}

function isActionable(status: TranslatedSegmentStatus) {
  return status === 'pending' || status === 'failed';
}

function filterLabel(filter: Filter) {
  return { all: '全部', pending: '待翻译', translated: '已翻译', failed: '失败' }[filter];
}

function segmentTypeLabel(type: SegmentType) {
  const labels: Record<SegmentType, string> = {
    paragraph: '段落',
    heading: '标题',
    table: '表格',
    math: '公式',
    figure: '图片',
    code: '代码',
    list: '列表',
    page_header: '页眉',
    page_footer: '页脚',
    page_number: '页码',
    aside_text: '侧栏文字',
    page_footnote: '脚注'
  };
  return labels[type];
}
