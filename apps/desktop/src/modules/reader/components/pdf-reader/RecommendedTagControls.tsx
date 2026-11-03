import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TagRecommendation } from '@/shared/ipc/assistantApi';
import { pendingTagRecommendations } from './entryTagSuggestionStore';

export function RecommendedTagControls({ error, appliedPaths, busy, open, recommendedTags,
  selectedRecommendedTagPaths, onApply, onDismiss, onOpenChange, onToggleTag,
  onGenerate, disabledReason, generatedAt, phase }: {
  error?: string | null; appliedPaths: string[]; busy: boolean; open: boolean;
  recommendedTags: TagRecommendation[]; selectedRecommendedTagPaths: string[];
  onApply: () => void; onDismiss: () => void; onOpenChange: (open: boolean) => void;
  onToggleTag: (tag: TagRecommendation) => void; onGenerate?: () => void;
  disabledReason?: string | null; generatedAt?: string | null; phase?: 'idle' | 'generating' | 'applying';
}) {
  const pending = pendingTagRecommendations(recommendedTags, appliedPaths);
  const selected = new Set(selectedRecommendedTagPaths);
  const selectedCount = pending.filter(tag => selected.has(tag.path)).length;
  const generating = phase === 'generating';
  const trigger = useRef<HTMLButtonElement>(null);
  const toolbar = useRef<HTMLElement | null>(null);
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>
      <Button ref={trigger} onFocus={event => { toolbar.current = event.currentTarget.closest('[data-guide="pdf-tools"]'); }} aria-label={generating ? '推荐标签，正在生成' : `推荐标签 ${pending.length} 项`} size="sm"
        className="shrink-0" title={error ? '推荐标签生成或保存失败，点击查看' : '查看并添加推荐标签'}
        type="button" variant={open ? 'secondary' : 'outline'}>
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
        <span>{generating ? '生成中…' : '推荐标签'}</span>
        {pending.length > 0 ? <Badge variant="outline">{pending.length}</Badge> : null}
      </Button>
    </PopoverTrigger>
    <PopoverContent viewportAligned align="end" side="bottom" sideOffset={8} collisionPadding={16}
      onCloseAutoFocus={event => {
        if (!trigger.current?.isConnected && toolbar.current?.isConnected) {
          event.preventDefault();
          toolbar.current.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
        }
      }}
      className="flex max-h-[min(32rem,var(--radix-popover-content-available-height))] w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-hidden p-4">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">推荐标签</p>
        {onGenerate && !generatedAt ? <Button size="xs" variant="outline" disabled={busy || Boolean(disabledReason)}
          title={disabledReason ?? undefined} onClick={onGenerate}>
          {generating ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />}
          {generating ? '正在生成…' : error ? '重试生成' : '生成推荐标签'}
        </Button> : null}
      </div>
      <div className="grid min-h-0 min-w-0 gap-2 overflow-y-auto pr-1 [scrollbar-gutter:stable] [overflow-wrap:anywhere]">
        {pending.map(tag => <Button key={tag.path} className="h-auto min-w-0 justify-between gap-2 whitespace-normal px-3 py-2 text-left"
          size="sm" type="button" variant={selected.has(tag.path) ? 'secondary' : 'outline'} disabled={busy}
          aria-label={tag.path} aria-pressed={selected.has(tag.path)} onClick={() => onToggleTag(tag)}>
          <span className="grid min-w-0 gap-0.5">
            <span>{tag.path}</span><span className="text-[11px] text-muted-foreground">{tag.dimension} · {tag.reason}</span>
          </span>
          <Badge variant="outline" className="shrink-0">{Math.round(tag.confidence * 100)}%</Badge>
        </Button>)}
        {!pending.length ? <p className="text-xs text-muted-foreground">{generating ? '正在分析论文，生成推荐标签…' : generatedAt ? '暂无新的推荐标签。' : '配置模型并完成解析后，将自动生成推荐标签。'}</p> : null}
        {disabledReason ? <p className="text-xs text-muted-foreground">{disabledReason}</p> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-2">
        <Button disabled={busy} size="xs" type="button" variant="ghost" onClick={onDismiss}>不接受</Button>
        {pending.length > 0 ? <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">已选 {selectedCount} 项</span>
          <Button disabled={busy || selectedCount === 0} size="xs" type="button" onClick={onApply}>
            {phase === 'applying' ? '添加中…' : '确认添加'}
          </Button>
        </div> : null}
      </div>
      <p className="text-xs text-muted-foreground">之后可在条目详情中重新生成推荐标签。</p>
    </PopoverContent>
  </Popover>;
}
