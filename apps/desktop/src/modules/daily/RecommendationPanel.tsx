import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RecommendationCard } from './RecommendationCard';
import { useDaily } from './DailyContext';
import { useRecommendations } from './RecommendationContext';

export function RecommendationPanel({ compact = false, active = false }: { compact?: boolean; active?: boolean }) {
  const daily = useDaily(), model = useRecommendations();
  const [showIgnored, setShowIgnored] = useState(false);
  useEffect(() => { if (active) model?.ensureToday(); }, [active, model?.ensureToday]);
  if (!daily || !model) return null;
  const batch = model.state?.batches.find(b => b.date === daily.date);
  const cached = batch ?? (model.error && model.state ? model.state.batches[model.state.batches.length - 1] : undefined);
  const papers = cached?.papers.filter(p => { const feedback = model.state?.feedback.find(f => f.id === p.id); return showIgnored || !feedback?.ignored; }) ?? [];
  const needsReading = model.error?.startsWith('暂无近期阅读标签');
  return <section id="daily-recommendations" tabIndex={-1} aria-label={compact ? '推荐摘要' : '每日论文推荐'} className={compact ? 'space-y-2 text-xs' : 'min-w-0 space-y-3 scroll-mt-4 @container/recommendations'}>
    <div className="flex flex-wrap items-center gap-3">{!compact ? <h2 className="mr-auto text-sm font-medium">每日论文推荐</h2> : null}
      <div className="flex flex-wrap items-center gap-3">
        {!compact && cached ? <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={showIgnored} onChange={e => setShowIgnored(e.target.checked)} />显示已忽略</label> : null}
        <Button size="xs" variant={compact ? 'plain' : 'outline'} disabled={!daily.root || !daily.state || model.busy || daily.date !== daily.today} onClick={() => model.refresh(true)}>{model.busy ? '获取中…' : batch ? '刷新推荐' : '获取今日推荐'}</Button>
      </div>
    </div>
    {!compact ? <p className="text-xs text-muted-foreground">根据最近 14 天阅读论文的标签自动推荐，每天首次获取后保存到本地。</p> : null}
    {model.error ? <div role={needsReading ? 'status' : 'alert'} className={`text-xs ${needsReading ? 'text-muted-foreground' : 'text-destructive'}`}>{model.error}{!needsReading ? <><Button size="xs" variant="ghost" disabled={model.busy || daily.date !== daily.today} onClick={() => model.refresh(true)}>重试获取</Button><Button size="xs" variant="ghost" onClick={() => model.refresh(false)}>读取缓存</Button></> : null}</div> : null}
    {daily.error ? <p role="alert" className="text-xs text-destructive">{daily.error}<Button size="xs" variant="ghost" onClick={daily.retry}>重试读取</Button></p> : null}
    {cached ? <p className="text-xs text-muted-foreground">{cached.date} · 推荐记录已保存到本地{!compact ? ` · arXiv · ${cached.interests.slice(0, 5).join('、')}` : ''}{model.busy ? ' · 更新中…' : ''}</p> : !model.busy ? <p className="text-xs text-muted-foreground">{daily.date === daily.today ? '每天首次打开自动获取，成功后保存到本地，当天不重复检索。' : '该日期没有保存的推荐批次。'}</p> : <p role="status" className="text-xs">正在准备检索并获取 arXiv 论文，首次使用需要安装检索工具…</p>}
    <div className={compact ? 'space-y-2' : 'grid grid-cols-1 gap-3 @min-[580px]/recommendations:grid-cols-2 @min-[940px]/recommendations:grid-cols-3'}>
    {papers.slice(0, compact ? 3 : 10).map(paper => {
      const feedback = model.state?.feedback.find(f => f.id === paper.id);
      return compact ? <div key={paper.id} className="rounded-lg border p-3"><p>{paper.title}</p><p className="mt-1 text-muted-foreground">{paper.reasons[0]}</p></div> : <RecommendationCard key={paper.id} paper={paper} busy={model.busy} ignored={feedback?.ignored ?? false}
        onIgnore={() => model.feedback(paper.id, !feedback?.ignored, feedback?.saved ?? false)} />;
    })}
    </div>
    {cached && !papers.length && !model.busy && !model.error ? <div className="text-xs text-muted-foreground">
      {cached.papers.length ? <><p>当前推荐均已忽略。</p><Button size="xs" variant="link" className="px-0" onClick={() => setShowIgnored(true)}>显示全部推荐</Button></>
        : <p>本次没有找到匹配的新论文，可能已推荐过或已在资料库中。继续阅读，明天会根据近期阅读标签获取新推荐。</p>}
    </div> : null}
    {compact && papers.length > 3 ? <p className="text-muted-foreground">完整推荐及导入操作见每日看板。</p> : null}
  </section>;
}
