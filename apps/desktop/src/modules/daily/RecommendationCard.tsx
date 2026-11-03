import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ResearchPaperAction } from '@/modules/assistant/components/ResearchPaperActions';
import { WorkspaceWebLink } from '@/shared/components/WorkspaceWebLink';
import type { RecommendedPaper } from './RecommendationContext';
import { useState } from 'react';

export function RecommendationCard({ paper, busy, ignored, onIgnore }: {
  paper: RecommendedPaper; busy: boolean; ignored: boolean; onIgnore: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <ResearchPaperAction paper={paper} variant="card" titleLink={false} className={ignored ? 'border-dashed bg-muted/60 text-muted-foreground' : 'border-border/80'} secondaryActions={<>
      <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button size="sm" variant="outline">预览</Button></PopoverTrigger>
        <PopoverContent viewportAligned align="start" collisionPadding={12} className="w-[26rem] max-w-[min(calc(100vw-2rem),var(--radix-popover-content-available-width))] max-h-[min(34rem,var(--radix-popover-content-available-height))] gap-0 overflow-hidden p-0 text-xs leading-relaxed">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2">
            <span className="font-medium">论文预览</span><Button size="xs" variant="ghost" onClick={() => setOpen(false)}>关闭</Button>
          </div>
          <div tabIndex={0} role="region" aria-label="论文预览内容" className="min-h-0 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere]">
            <h3 className="text-sm font-medium">{paper.title}</h3>
            <p className="mt-2 text-muted-foreground">{paper.authors.join('、')}</p>
            <p className="mt-2 text-muted-foreground">{paper.published.slice(0, 10)} · {paper.categories.join(' · ')} · 摘要证据</p>
            <div className="mt-4 border-t pt-3"><h4 className="mb-2 font-medium">摘要</h4><p className="whitespace-pre-wrap">{paper.abstract_text || '暂无摘要'}</p></div>
            <div className="mt-4 border-t pt-3"><h4 className="mb-2 font-medium">推荐理由</h4><p className="text-muted-foreground">{paper.reasons.join('；')}</p></div>
          </div>
        </PopoverContent>
      </Popover>
      <WorkspaceWebLink href={paper.url} asButton>查看详情</WorkspaceWebLink>
      <Button size="sm" variant="outline" disabled={busy} onClick={onIgnore}>{ignored ? '恢复推荐' : '忽略'}</Button>
  </>}>
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
      {paper.categories.slice(0, 2).map(category => <span key={category} className="rounded-sm bg-muted px-1.5 py-0.5">{category}</span>)}
      {ignored ? <span className="rounded-sm border px-1.5 py-0.5">已忽略</span> : null}
      <span className="ml-auto tabular-nums">{paper.published.slice(0, 10)}</span>
    </div>
    <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">{paper.abstract_text || '暂无摘要'}</p>
    <div className="mt-3 rounded-md bg-muted/40 px-2.5 py-2">
      <p className="mb-1 text-[10px] font-medium text-muted-foreground">推荐依据</p>
      <p className="line-clamp-2 text-xs leading-relaxed">{paper.reasons[0] || '与你近期阅读的标签相关'}</p>
    </div>
  </ResearchPaperAction>;
}
