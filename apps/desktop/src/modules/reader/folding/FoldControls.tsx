import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { FoldLevel, FoldReader } from './useFoldReader';

export const FOLD_LEVELS: Array<{ value: Exclude<FoldLevel, 'off'>; label: string }> = [
  { value: 'full', label: '原文' },
  { value: 'brief', label: '精简' }, { value: 'key', label: '要点' },
  { value: 'takeaway', label: '结论' }, { value: 'topic', label: '主题' }
];

export function FoldControls({ fold, onLevelChange, onShowProgress }: { fold: FoldReader; onLevelChange: (level: FoldLevel) => void; onShowProgress: () => void }) {
  const progress = fold.task?.progress;
  const completed = progress ? progress.completed + progress.failed + (progress.canceledSegmentUids?.length ?? 0) : 0;
  return <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="阅读详略">
    <span className="shrink-0 text-xs text-muted-foreground">阅读详略</span>
    <Select value={fold.level === 'off' ? '' : fold.level} onValueChange={value => onLevelChange(value as FoldLevel)}>
      <Tooltip><TooltipTrigger asChild><span className="inline-flex">
        <SelectTrigger size="sm" className="w-[104px]" aria-label="阅读详略"><SelectValue placeholder="逐句模式" /></SelectTrigger>
      </span></TooltipTrigger><TooltipContent>{fold.level === 'off'
        ? '逐句模式下暂不使用段落详略；选择任一详略级别可回到整段阅读。'
        : '原文表示完整、未压缩的内容；不改变源语言和中文译文的显示设置。'}</TooltipContent></Tooltip>
      <SelectContent>{FOLD_LEVELS.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select>
    <Button size="sm" variant="outline" onClick={onShowProgress}>{fold.running ? (progress?.total ? `查看进度 ${completed}/${progress.total}` : '查看进度') : '生成详略'}</Button>
    <span role="status" className="text-xs text-muted-foreground">{fold.task?.status === 'paused' ? '已暂停' : fold.task?.status === 'pausing' ? '正在暂停…' : fold.task?.status === 'stopping' ? '正在停止…' : fold.running ? '' : fold.loadState === 'loading' ? '正在读取' : fold.error ?? ''}</span>
    {fold.loadState === 'error' ? <Button size="sm" variant="ghost" onClick={() => void fold.reload()}>重试读取</Button> : null}
  </div>;
}
