import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TooltipIconButton } from '@/shared/components/TooltipIconButton';
import type { SourceSegment } from '@/shared/types/domain';
import { buildFoldInputs, FOLD_MIN_CJK, FOLD_MIN_WORDS } from './foldInput';
import { FoldTaskPreview } from './FoldTaskPreview';
import { FOLD_TASK_FILTERS, foldTaskFilterForStatus, type FoldTaskFilter, type FoldTaskRowStatus } from './foldTaskFilters';
import { missingFoldTranslations } from './foldTranslations';
import { foldViewsForSource } from './foldViews';
import { FOLD_CONCURRENCY } from './generateEntryFolds';
import type { FoldReader } from './useFoldReader';

export function FoldTaskDialog({ open, onOpenChange, fold }: { open: boolean; onOpenChange: (open: boolean) => void; fold: FoldReader }) {
  // Selection stays in the dialog; the queue and its pause state belong to the shared entry task.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FoldTaskFilter>('all');
  const [page, setPage] = useState('all');
  const [query, setQuery] = useState('');
  const [confirmReplace, setConfirmReplace] = useState<SourceSegment[] | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const task = fold.task;
  const progress = task?.progress;
  useEffect(() => { setSelected(new Set()); setConfirmReplace(null); setFilter('all'); setPage('all'); setQuery(''); }, [fold.root, fold.entryId]);
  useEffect(() => { setConfirmReplace(null); }, [open, task?.segments]);
  const inputs = useMemo(() => buildFoldInputs(fold.segments), [fold.segments]);
  const rows = useMemo(() => {
    const eligible = new Set(inputs.batches.flat().map(item => item.segmentUid));
    return fold.segments.filter(segment => eligible.has(segment.uid));
  }, [inputs, fold.segments]);
  const sourceSaved = useMemo(() => new Set(inputs.batches.flat().filter(item => {
    const record = fold.records[item.segmentUid];
    return record && foldViewsForSource(record, item.source);
  }).map(item => item.segmentUid)), [inputs, fold.records]);
  const saved = new Set([...sourceSaved].filter(uid => missingFoldTranslations(fold.records[uid]).length === 0));
  const currentSources = new Map(fold.segments.map(segment => [segment.uid, segment.text.trim()]));
  const scope = new Set(task?.segments.filter(segment => currentSources.get(segment.uid) === segment.text.trim()).map(segment => segment.uid) ?? []);
  const active = new Set(progress?.activeSegmentUids ?? []);
  const saving = new Set(progress?.savingSegmentUids ?? (progress?.phase === 'saving' ? progress.activeSegmentUids : []));
  const translating = new Set(progress?.translatingSegmentUids ?? []);
  const completed = new Set(progress?.completedSegmentUids ?? []);
  const failed = new Set(progress?.failedSegmentUids ?? []);
  const cached = new Set(progress?.cachedSegmentUids ?? []);
  const canceled = new Set(progress?.canceledSegmentUids ?? []);
  const done = progress ? progress.completed + progress.failed + canceled.size : 0;
  const allCached = task?.status === 'succeeded' && progress?.total === 0 && cached.size > 0;
  const percent = progress?.total ? Math.round(done / progress.total * 100) : allCached ? 100 : 0;
  const running = task?.status === 'running';
  const pausing = task?.status === 'pausing';
  const paused = task?.status === 'paused';
  const stopping = task?.status === 'stopping';
  const controllable = running || pausing || paused;
  const locked = controllable || stopping;
  const loading = !fold.ready || fold.loadState === 'loading';
  const canStart = Boolean(fold.root && !loading && fold.loadState === 'ready' && !locked);
  const hasResult = (uid: string) => saved.has(uid) || (scope.has(uid) && (completed.has(uid) || cached.has(uid)));
  const canCancel = (uid: string) => Boolean(controllable && scope.has(uid) && progress?.total && !completed.has(uid) && !failed.has(uid) &&
    !cached.has(uid) && !canceled.has(uid) && !saving.has(uid));
  const stateLabel = (uid: string): FoldTaskRowStatus => scope.has(uid) && canceled.has(uid) ? '已取消' : scope.has(uid) && failed.has(uid) ? '失败' : scope.has(uid) && active.has(uid) ?
    (saving.has(uid) ? '保存中' : translating.has(uid) ? '翻译中' : '生成中') : scope.has(uid) && completed.has(uid) ? '已完成' : hasResult(uid) ? '已缓存' :
      scope.has(uid) ? (paused ? '已暂停' : locked ? '待处理' : '未完成') : fold.records[uid] && foldViewsForSource(fold.records[uid], currentSources.get(uid) ?? '') ? '待补译' : '未生成';
  const selectedRows = rows.filter(segment => selected.has(segment.uid));
  const pendingSelected = selectedRows.filter(segment => !hasResult(segment.uid));
  const cancelable = selectedRows.filter(segment => canCancel(segment.uid));
  const selectedSaved = selectedRows.length - pendingSelected.length;
  const pages = [...new Set(rows.map(segment => segment.page_idx + 1))].sort((a, b) => a - b);
  const search = query.trim().toLocaleLowerCase();
  const matching = rows.map((segment, index) => ({ segment, ordinal: index + 1, status: stateLabel(segment.uid) }))
    .filter(({ segment }) => (page === 'all' || String(segment.page_idx + 1) === page) && (!search || segment.text.toLocaleLowerCase().includes(search)));
  const visible = matching.filter(row => filter === 'all' || foldTaskFilterForStatus(row.status) === filter);
  const counts = Object.fromEntries(FOLD_TASK_FILTERS.map(item => [item.value,
    matching.filter(row => item.value === 'all' || foldTaskFilterForStatus(row.status) === item.value).length])) as Record<FoldTaskFilter, number>;
  const visibleSelected = visible.filter(row => selected.has(row.segment.uid)).length;
  const hiddenSelected = selectedRows.length - visibleSelected;
  const allSelected = visible.length > 0 && visibleSelected === visible.length;
  const updateVisibleSelection = (checked: boolean) => setSelected(current => {
    const next = new Set(current);
    for (const { segment } of visible) { if (checked) next.add(segment.uid); else next.delete(segment.uid); }
    return next;
  });
  const run = (segments: SourceSegment[], force = false) => {
    if (!canStart || !segments.length) return;
    if (force && segments.some(segment => hasResult(segment.uid))) setConfirmReplace(segments);
    else fold.start(segments, force);
  };
  const title = !task ? (loading ? '正在读取段落与已有结果…' : fold.loadState === 'error' ? '读取详略失败' : '请选择需要生成详略的正文段落') :
    task.status === 'canceled' ? '已停止生成' : task.status === 'failed' ? '生成未完成' : allCached ? '已有结果，无需生成' :
      task.status === 'succeeded' ? (canceled.size ? '任务完成，部分段落已取消' : '生成完成') : stopping ? '正在停止生成' :
        paused ? '任务已暂停' : pausing ? '正在暂停，等待当前段落处理完成' :
          progress?.phase === 'generating' ? '正在生成阅读详略' : progress?.phase === 'saving' ? '正在保存结果' : '正在检查并准备段落';

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent layout="bounded" className="max-w-[60rem] gap-3 sm:max-w-[60rem]"
      onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => {
        if (returnFocus.current?.isConnected && returnFocus.current !== document.body) {
          event.preventDefault(); returnFocus.current.focus({ preventScroll: true });
        }
      }}>
      <DialogHeader>
        <DialogTitle>阅读详略任务</DialogTitle>
        <DialogDescription>同时生成原文详略与中文详略；已有原文只补缺失译文。勾选正文段落后开始生成，最多同时处理 {FOLD_CONCURRENCY} 段。关闭窗口不会停止任务。</DialogDescription>
      </DialogHeader>
      <div className="grid shrink-0 gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2" role="status" aria-live="polite">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><span>{title}{progress?.total ? ` · 已处理 ${done}/${progress.total} 段` : ''}</span>{progress?.total || allCached ? <span>{percent}%</span> : null}</div>
        {task ? <Progress value={percent} aria-label="阅读详略生成进度" /> : null}
        {progress ? <p className="text-xs text-muted-foreground">处理中 {active.size} · 已完成 {progress.completed} · 失败 {progress.failed} · 已取消 {canceled.size} · 已缓存 {cached.size}</p> : null}
        {fold.loadState === 'error' ? <div className="flex items-center gap-2"><p role="alert" className="text-xs text-destructive">无法读取已有详略，请重试后再生成。</p><Button size="xs" variant="outline" onClick={() => void fold.reload()}>重试读取</Button></div> :
          task?.status === 'failed' ? <p role="alert" className="text-xs text-destructive">{task.error ?? fold.error ?? '详略生成失败，已有结果保留，可重试未完成的段落。'}</p> : null}
        {paused ? <p className="text-xs text-muted-foreground">原选择范围与进度已保留，继续后处理剩余段落；停止将结束本次任务。</p> :
          pausing ? <p className="text-xs text-muted-foreground">已停止派发新段落，当前生成和保存完成后暂停。</p> :
            task?.status === 'canceled' ? <p className="text-xs text-muted-foreground">已保存的结果保留，可重新选择未完成的段落生成。</p> :
              running ? <p className="text-xs text-muted-foreground">暂停保留待处理队列；停止中止未完成的生成。保存中的段落会先完成写入。</p> : null}
        {!task ? <p className="text-xs text-muted-foreground">仅列出适合详略的正文：至少 {FOLD_MIN_WORDS} 个词或 {FOLD_MIN_CJK} 个中文字；标题、公式和短段落等自动跳过。</p> : null}
      </div>
      <div className="grid shrink-0 gap-2" role="group" aria-label="筛选详略段落">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">任务状态</span>
          {FOLD_TASK_FILTERS.map(item => <Button key={item.value} size="xs" variant={filter === item.value ? 'secondary' : 'outline'}
            aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label} {counts[item.value]}</Button>)}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="搜索正文" placeholder="搜索正文…" className="h-7 min-w-[10rem] flex-1 text-xs" value={query} onChange={event => setQuery(event.target.value)} />
          <Select value={page} onValueChange={setPage}><SelectTrigger size="sm" className="w-[108px]" aria-label="筛选页码"><SelectValue /></SelectTrigger>
            <SelectContent viewportAligned><SelectItem value="all">全部页码</SelectItem>{pages.map(value => <SelectItem key={value} value={String(value)}>第 {value} 页</SelectItem>)}</SelectContent>
          </Select>
          {filter !== 'all' || page !== 'all' || query ? <Button size="xs" variant="ghost" onClick={() => { setFilter('all'); setPage('all'); setQuery(''); }}>重置筛选</Button> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>显示 {visible.length}/{rows.length} 段 · 已选择 {selectedRows.length} 段{selectedSaved ? `（已有结果 ${selectedSaved} 段）` : ''}{hiddenSelected ? ` · 筛选外已选 ${hiddenSelected} 段` : ''}</span>
        <span className="min-w-0 flex-1" />
        {selectedRows.length ? <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>清空选择</Button> : null}
        {!locked ? <>
          <Button size="xs" variant="outline" title="选择当前筛选范围内尚无结果的段落，保留其他已选项" disabled={!canStart || !visible.some(({ segment }) => !hasResult(segment.uid))}
            onClick={() => setSelected(current => new Set([...current, ...visible.filter(({ segment }) => !hasResult(segment.uid)).map(({ segment }) => segment.uid)]))}>选择未生成</Button>
          {selectedSaved > 0 ? <Button size="xs" variant="outline" disabled={!canStart} onClick={() => run(selectedRows, true)}>重新生成所选（{selectedRows.length}）</Button> : null}
        </> : <Button size="xs" variant="outline" disabled={!cancelable.length || stopping} onClick={() => fold.cancelSegments(cancelable.map(segment => segment.uid))}>取消所选（{cancelable.length}）</Button>}
      </div>
      <DialogBody className="rounded-md border overflow-x-auto" tabIndex={0} aria-label="正文段落列表">
        {visible.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">{loading ? '正在读取段落列表…' : rows.length ? '当前筛选下没有段落，请调整或重置筛选。' : '没有符合条件的正文段落，标题、公式和短段落等无需生成详略。'}</p> :
          <div role="table" aria-label="阅读详略段落" className="min-w-[20rem] text-sm">
            <div role="row" className="sticky top-0 z-[1] grid grid-cols-[1.25rem_3rem_minmax(0,1fr)_4rem_5rem] items-center gap-2 border-b bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
              <span role="columnheader"><Checkbox aria-label="全选当前列表" disabled={loading} checked={allSelected ? true : visibleSelected ? 'indeterminate' : false} onCheckedChange={checked => updateVisibleSelection(checked === true)} /></span>
              <span role="columnheader">页码</span><span role="columnheader">正文段落</span><span role="columnheader">状态</span><span role="columnheader" className="text-right">操作</span>
            </div>
            {visible.map(({ segment, ordinal, status }) => <div role="row" key={segment.uid} className="grid grid-cols-[1.25rem_3rem_minmax(0,1fr)_4rem_5rem] items-center gap-2 border-b px-3 py-1.5 last:border-b-0">
              <span role="cell"><Checkbox aria-label={`选择第 ${segment.page_idx + 1} 页第 ${ordinal} 段`} disabled={loading} checked={selected.has(segment.uid)} onCheckedChange={checked => setSelected(current => { const next = new Set(current); if (checked === true) next.add(segment.uid); else next.delete(segment.uid); return next; })} /></span>
              <span role="cell">{segment.page_idx + 1}</span>
              <span role="cell" className="flex min-w-0 items-center gap-1"><span className="min-w-0 flex-1 truncate">{segment.text}</span>
                <FoldTaskPreview segment={segment} ordinal={ordinal} status={status} record={sourceSaved.has(segment.uid) ? fold.records[segment.uid] : undefined}
                  error={scope.has(segment.uid) ? progress?.segmentErrors?.[segment.uid] : undefined} />
              </span>
              <span role="cell" title={scope.has(segment.uid) ? progress?.segmentErrors?.[segment.uid] : undefined} aria-label={scope.has(segment.uid) && progress?.segmentErrors?.[segment.uid] ? `失败：${progress.segmentErrors[segment.uid]}` : undefined} className={status === '失败' ? 'text-destructive' : 'text-muted-foreground'}>{status}</span>
              <span role="cell" className="flex justify-end">{canCancel(segment.uid) ? <TooltipIconButton label={`取消第 ${segment.page_idx + 1} 页第 ${ordinal} 段`} tooltip="取消此段" variant="ghost" onClick={() => fold.cancelSegments([segment.uid])}><X size={14} /></TooltipIconButton> :
                !locked && (hasResult(segment.uid) || scope.has(segment.uid)) ? <TooltipIconButton label={`${hasResult(segment.uid) ? '重新生成' : '重试'}第 ${segment.page_idx + 1} 页第 ${ordinal} 段`} tooltip={hasResult(segment.uid) ? '重新生成此段' : '重试此段'} variant="ghost" disabled={!canStart} onClick={() => run([segment], hasResult(segment.uid))}><RotateCcw size={14} /></TooltipIconButton> : null}</span>
            </div>)}
          </div>}
      </DialogBody>
      {confirmReplace ? <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm" role="alert"><span className="min-w-0 flex-1">重新生成所选 {confirmReplace.length} 段将替换其中已有的详略结果，是否继续？</span><Button size="xs" variant="outline" onClick={() => setConfirmReplace(null)}>取消</Button><Button size="xs" disabled={!canStart} onClick={() => { const chosen = confirmReplace; setConfirmReplace(null); if (canStart) fold.start(chosen, true); }}>确认重新生成</Button></div> : null}
      <DialogFooter className="flex !flex-row gap-2">
        {locked ? <>
          {!stopping ? <Button className="flex-1" disabled={pausing} onClick={paused ? fold.resume : fold.pause}>{paused ? '继续生成' : pausing ? '正在暂停…' : '暂停生成'}</Button> : null}
          <Button className="flex-1" variant="outline" disabled={stopping} onClick={fold.cancel}>{stopping ? '正在停止…' : '停止全部'}</Button>
        </> : <Button className="flex-1" disabled={!canStart || !pendingSelected.length} onClick={() => run(pendingSelected)}>开始生成（{pendingSelected.length}）</Button>}
        <Button className="flex-1" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
