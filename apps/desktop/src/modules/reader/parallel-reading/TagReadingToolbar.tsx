import { ArrowLeft, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type Progress = { done: number; total: number; skipped: number; unavailable: number };

export function TagReadingToolbar({ title, path, compact, progress, saveStatus, disabled, noteDisabled = disabled, loaded, queueVisible, hasCompare, canFinish, viewingCompare, currentTitle,
  includeDescendants, onBack, onQueue, onCompare, onNote, hasNote, onCloseNote, onFinish, onSwap, onRemoveCompare, onIncludeDescendants, onReload }: {
  title: string; path: string; compact: boolean; progress: Progress | null; saveStatus: string;
  disabled: boolean; loaded: boolean; queueVisible: boolean; hasCompare: boolean; canFinish: boolean;
  noteDisabled?: boolean;
  viewingCompare: boolean; currentTitle: string; includeDescendants: boolean;
  onBack: () => void; onQueue: () => void; onCompare: () => void; onFinish: () => void;
  onNote?: () => void; hasNote?: boolean; onCloseNote?: () => void;
  onSwap: () => void; onRemoveCompare: () => void; onIncludeDescendants: (value: boolean) => void; onReload: () => void;
}) {
  const finishHint = viewingCompare ? '请先切回主读论文，再标记已读' : `将主读论文“${currentTitle}”标为已读，并打开下一篇未读论文；对照论文保持不变`;
  const progressText = progress ? `${progress.done}/${progress.total} 已读` : '加载进度…';
  const progressDetails = progress
    ? `已读 ${progress.done} / ${progress.total} 篇；跳过 ${progress.skipped} 篇，暂不可读 ${progress.unavailable} 篇（不计入进度）`
    : '正在读取论文和阅读进度';
  return <header aria-label="平行阅读操作栏" className="flex h-10 min-w-0 shrink-0 items-center gap-1 border-b bg-card px-2" data-testid="tag-reading-toolbar">
    <Button size="icon-sm" variant="ghost" aria-label="返回条目库" title="返回条目库" onClick={onBack}><ArrowLeft size={14} aria-hidden="true" /></Button>
    <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" title={path}>{title}</h2>
    {!compact ? <Popover>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label="标签任务进度" title={progressDetails}>{progressText}</Button></PopoverTrigger>
      <PopoverContent viewportAligned align="end" className="w-72 space-y-2 text-xs">
        <p className="font-medium">阅读进度</p><p>{progressDetails}</p><p className="text-muted-foreground">主读论文用于逐篇阅读；对照论文固定保留，换篇时不替换。</p>
      </PopoverContent>
    </Popover> : null}
    <span aria-live="polite" className="shrink-0 text-xs text-muted-foreground">{saveStatus !== '已保存' ? saveStatus : null}</span>
    <Button size="sm" variant="outline" disabled={!loaded || disabled} aria-label={queueVisible ? '收起论文列表' : '打开论文列表'} title={queueVisible ? '收起左侧论文列表，扩大阅读区' : '选择主读论文或调整阅读顺序'} onClick={onQueue}>
      {compact ? '论文' : queueVisible ? '收起列表' : '论文列表'}
    </Button>
    <Button size="sm" variant={hasCompare ? 'secondary' : 'outline'} disabled={!loaded || disabled} aria-label={hasCompare ? '更换对照论文' : '选择对照论文'} title="选择一篇固定对照论文，不替换主读论文" onClick={onCompare}>
      {compact ? '对照' : hasCompare ? '更换对照' : '添加对照'}
    </Button>
    {onNote ? <Button size="sm" variant={hasNote ? 'secondary' : 'outline'} disabled={noteDisabled} aria-label="打开文档笔记" title="打开已有笔记或新建标签笔记" onClick={onNote}>笔记</Button> : null}
    <span title={finishHint} className="shrink-0">
      <Button size="sm" disabled={disabled || !canFinish || viewingCompare} aria-label="主读已读，下一篇" title={finishHint} onClick={onFinish}>{compact ? '读完' : '读完换篇'}</Button>
    </span>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="平行阅读设置与操作" title="阅读范围、对照和进度设置"><MoreHorizontal size={14} aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent viewportAligned align="end" className="w-72">
        <DropdownMenuLabel>阅读进度{saveStatus ? ` · ${saveStatus}` : ''}</DropdownMenuLabel>
        <p className="px-2 pb-2 text-xs text-muted-foreground">{progressDetails}</p>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>阅读范围</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={includeDescendants} disabled={disabled || !loaded} onCheckedChange={onIncludeDescendants}>包含子标签中的论文</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>对照论文</DropdownMenuLabel>
        <DropdownMenuItem disabled={disabled || !hasCompare} onSelect={onSwap}>交换主读与对照论文</DropdownMenuItem>
        <DropdownMenuItem disabled={disabled || !hasCompare} onSelect={onRemoveCompare}>{hasNote ? '取消对照（保留文档笔记）' : '取消对照，回到单篇阅读'}</DropdownMenuItem>
        {onCloseNote ? <DropdownMenuItem disabled={disabled || !hasNote} onSelect={onCloseNote}>关闭文档笔记（保留文件）</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!loaded || saveStatus === '保存中…'} onSelect={onReload}>重新载入已保存进度</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </header>;
}
