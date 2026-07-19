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
  detail,
  message,
  progress,
  onOpenChange,
  onTranslate
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
        status: translated?.status === 'skipped' ? 'pending' : translated?.status ?? 'pending',
        error: translated?.status === 'skipped' ? null : translated?.error ?? null
      };
    }),
    [segments, statuses]
  );
  const visible = rows.filter(
    (row) =>
      selectedTypes.has(row.segment.segment_type) &&
      (filter === 'all' || row.status === filter)
  );
  const counts = rows.reduce<Record<Filter, number>>((current, row) => {
    current.all += 1;
    if (row.status === 'translated') current.translated += 1;
    else if (row.status === 'failed') current.failed += 1;
    else current.pending += 1;
    return current;
  }, { all: 0, pending: 0, translated: 0, failed: 0 });
  const completedCount = counts.translated + counts.failed;
  const displayedCompleted = busy && progress ? progress.current : completedCount;
  const displayedTotal = busy && progress ? progress.total : rows.length;
  const progressValue = busy && progress
    ? progress.percent
    : rows.length > 0
      ? (completedCount / rows.length) * 100
      : 0;

  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      return;
    }
    if (initializedForOpenRef.current || rows.length === 0) return;
    initializedForOpenRef.current = true;
    setSelectedTypes(new Set(ALL_SEGMENT_TYPES));
    setSelected(new Set(actionableRows(rows).map((row) => row.segment.uid)));
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
        else if (isActionable(row.status)) next.add(row.segment.uid);
      }
      return next;
    });
  };

  const run = (mode: RunMode) => {
    const candidates = rows.filter((row) => {
      if (!selected.has(row.segment.uid)) return false;
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
                ? `${message || '正在翻译'} · ${displayedCompleted}/${displayedTotal}`
                : `翻译进度：已完成 ${completedCount}/${rows.length}`}
            </span>
          </div>
          <Progress value={progressValue} />
          {busy && detail ? (
            <div className="text-xs text-muted-foreground">{detail}</div>
          ) : null}
        </div>

        <div className="grid gap-2 rounded-md border p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">翻译内容类型</span>
            <div className="flex gap-1">
              <Button
                size="xs"
                type="button"
                variant="ghost"
                onClick={() => {
                  setSelectedTypes(new Set(ALL_SEGMENT_TYPES));
                  setSelected(new Set(actionableRows(rows).map((row) => row.segment.uid)));
                }}
              >
                全选类型
              </Button>
              <Button
                size="xs"
                type="button"
                variant="ghost"
                onClick={() => {
                  setSelectedTypes(new Set());
                  setSelected(new Set());
                }}
              >
                清空
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ALL_SEGMENT_TYPES.map((segmentType) => {
              const enabled = selectedTypes.has(segmentType);
              const typeCount = rows.filter((row) => row.segment.segment_type === segmentType).length;
              return (
                <Button
                  aria-pressed={enabled}
                  disabled={typeCount === 0}
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

        <div className="flex flex-wrap gap-1.5">
          {(['all', 'pending', 'translated', 'failed'] as Filter[]).map((value) => (
            <Button
              key={value}
              size="xs"
              type="button"
              variant={filter === value ? 'secondary' : 'outline'}
              onClick={() => setFilter(value)}
            >
              {filterLabel(value)} {counts[value]}
            </Button>
          ))}
        </div>

        <div className="max-h-[min(48vh,28rem)] overflow-y-auto rounded-md border">
          {visible.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              当前筛选条件下没有 Block。可切换状态或重新选择内容类型。
            </div>
          ) : visible.map(({ segment, status, error }) => (
            <label className="flex items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50" key={segment.uid}>
              <input checked={selected.has(segment.uid)} type="checkbox" onChange={() => setSelected((current) => {
                const next = new Set(current);
                if (next.has(segment.uid)) next.delete(segment.uid); else next.add(segment.uid);
                return next;
              })} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">第 {segment.page_idx + 1} 页 · {segmentTypeLabel(segment.segment_type)}</span>
                {error ? <span className="block text-xs text-destructive">翻译失败，可重试</span> : null}
              </span>
              <SourcePreview segment={segment} />
              <Status status={status} />
            </label>
          ))}
        </div>

        <DialogFooter>
          <Button disabled={busy || selected.size === 0} size="sm" type="button" variant="outline" onClick={() => run('retry')}>
            <RotateCcw size={14} aria-hidden="true" />重试失败
          </Button>
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
    <HoverCard closeDelay={100} openDelay={150}>
      <HoverCardTrigger asChild>
        <Button
          aria-label="查看原文"
          size="icon-xs"
          type="button"
          variant="ghost"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <Eye aria-hidden="true" size={14} />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        align="end"
        className="z-[var(--z-dialog-popover)] w-[min(32rem,calc(100vw-2rem))] p-3"
        side="left"
      >
        <div className="mb-2 text-xs font-medium text-muted-foreground">原文 · 第 {segment.page_idx + 1} 页</div>
        <div className="max-h-[min(50vh,28rem)] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-sm leading-relaxed">
          {text || '该 Block 没有可显示的原文。'}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function Status({ status }: { status: TranslatedSegmentStatus }) {
  if (status === 'translated') return <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 size={13} />已翻译</span>;
  if (status === 'failed') return <span className="flex items-center gap-1 text-xs text-destructive"><CircleAlert size={13} />失败</span>;
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
