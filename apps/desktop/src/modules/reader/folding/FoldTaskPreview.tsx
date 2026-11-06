import { Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import type { SourceSegment } from '@/shared/types/domain';
import type { FoldRecord } from '@/shared/ipc/foldingApi';

export function FoldTaskPreview({ segment, ordinal, status, error, record }: {
  segment: SourceSegment; ordinal: number; status: string; error?: string; record?: FoldRecord;
}) {
  return <HoverCard>
    <HoverCardTrigger asChild openOnClick>
      <Button size="icon-xs" variant="ghost" className="shrink-0" aria-label={`查看第 ${segment.page_idx + 1} 页第 ${ordinal} 段详情`}
        onClick={event => event.stopPropagation()}><Eye size={14} aria-hidden="true" /></Button>
    </HoverCardTrigger>
    <HoverCardContent align="end" side="left" className="w-[34rem]">
      <div role="region" aria-label="段落详情" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
          <span>第 {segment.page_idx + 1} 页 · 第 {ordinal} 段</span><span>{status}</span>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <section><h3 className="mb-1 text-xs font-medium text-muted-foreground">完整原文</h3>
          <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-sm leading-relaxed">{segment.text}</p>
        </section>
        {record ? <section className="space-y-2 border-t pt-2">
          <h3 className="text-xs font-medium text-muted-foreground">已保存详略</h3>
          {([['精简', record.brief.join(' ')], ['要点', record.key], ['结论', record.takeaway], ['主题', record.topic]] as const).map(([label, text]) =>
            <div key={label}><h4 className="mb-0.5 text-xs text-muted-foreground">{label}</h4><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p></div>)}
        </section> : <p className="text-xs text-muted-foreground">暂无与当前原文匹配的详略结果。</p>}
      </div>
    </HoverCardContent>
  </HoverCard>;
}
