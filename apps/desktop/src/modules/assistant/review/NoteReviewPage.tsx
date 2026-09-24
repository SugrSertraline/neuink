import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNoteReview } from './NoteReviewContext';
import { buildNoteReviewDiff, noteReviewVersions } from './noteReviewDiff';
import { revealReviewTarget } from './reviewNavigation';
import { NoteDiffLines, NoteDiffContext, noteChangeKind } from './NoteDiffLines';
import { NoteReviewDecisionBar } from './NoteReviewDecisionBar';

export function NoteReviewPage({ proposalId, onOpenNote }: {
  proposalId: string; onOpenNote: (entryId: string, noteId: string) => void;
}) {
  const review = useNoteReview();
  const item = review?.items[proposalId];
  const proposal = item?.proposal;
  const [selected, setSelected] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const changeRefs = useRef(new Map<number, HTMLElement>());
  const result = useMemo(() => {
    if (!proposal) return { blocks: [], error: '修改记录尚未加载，请从对应的对话提案重新打开。' };
    try {
      const { before, after } = noteReviewVersions(proposal);
      return { blocks: buildNoteReviewDiff(before, after), error: null };
    } catch (error) { return { blocks: [], error: error instanceof Error ? error.message : String(error) }; }
  }, [proposal]);
  const count = result.blocks.filter(block => block.kind === 'change').length;
  const totals = result.blocks.reduce((total, block) => block.kind === 'change'
    ? { added: total.added + block.afterCount, removed: total.removed + block.beforeCount } : total, { added: 0, removed: 0 });
  const locate = (index: number) => {
    setSelected(index);
    const element = changeRefs.current.get(index);
    const viewport = scrollRef.current;
    if (element && viewport) {
      revealReviewTarget(viewport, element);
    }
  };
  const status = !proposal ? '修改记录未加载' : proposal.status === 'applied' ? '已应用 · 历史修改快照'
    : proposal?.status === 'rejected' ? '已忽略 · 历史修改快照'
      : proposal?.status === 'error' ? '修改遇到问题 · 请检查提示'
      : proposal?.status === 'applying' ? '正在应用…' : '待审阅 · 尚未写入正文';
  return <section className="flex h-full min-h-0 min-w-0 flex-col bg-card" aria-label="笔记修改审阅">
    <header className="flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-2">
      <div className="min-w-0 flex-[1_1_16rem]">
        <h2 className="truncate text-sm font-medium" title={proposal?.title}>{proposal?.title ?? '笔记修改'}</h2>
        <p className="text-xs text-muted-foreground">{status} · 只读审阅</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
      {proposal?.noteId ? <Button variant="outline" size="xs" onClick={() => onOpenNote(proposal.entryId, proposal.noteId!)}>打开当前笔记</Button> : null}
      <Button variant="outline" size="xs" disabled={!item} onClick={() => review?.returnToConversation(proposalId)}>
        <ArrowLeft size={13} aria-hidden="true" />返回对话提案
      </Button>
      </div>
    </header>
    <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-1.5 text-xs">
      <span aria-live="polite">{result.error ? '无法生成对比' : count ? `修改 ${Math.min(selected + 1, count)} / ${count}` : '没有正文差异'}</span>
      <Button size="xs" variant="ghost" disabled={!count || selected === 0} onClick={() => locate(selected - 1)}><ChevronUp size={13} />上一处</Button>
      <Button size="xs" variant="ghost" disabled={!count || selected >= count - 1} onClick={() => locate(selected + 1)}><ChevronDown size={13} />下一处</Button>
      {!result.error ? <span aria-label={`新增 ${totals.added} 行，删除 ${totals.removed} 行`} className="inline-flex gap-2 font-mono">
        <span className="text-success">+{totals.added}</span><span className="text-destructive">−{totals.removed}</span>
      </span> : null}
    </div>
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">
      <p className="mb-3 text-xs text-muted-foreground">Markdown 对比：红色 − 为删除，绿色 + 为新增；修改以删旧、增新成对显示。确认前不会写入笔记。</p>
      {result.error ? <p role="alert" className="text-sm text-destructive">{result.error}</p> : null}
      {proposal?.error ? <p role="alert" className="mb-2 text-xs text-destructive">{proposal.error}</p> : null}
      {proposal?.noteTitle && proposal.noteTitle !== proposal.title ? <div className="mb-3 border-l-2 border-primary pl-2 text-sm">
        <span className="font-medium">标题修改</span><p className="break-words">{proposal.noteTitle} → {proposal.title}</p>
      </div> : null}
      {result.blocks.map((block, index) => block.kind === 'context'
        ? <NoteDiffContext key={`context-${index}`} text={block.text} />
        : <section key={block.id} ref={element => { if (element) changeRefs.current.set(block.id, element); else changeRefs.current.delete(block.id); }}
          tabIndex={-1} aria-label={`修改 ${block.id + 1}`} className={`my-3 border-l-2 bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === block.id ? 'border-primary' : 'border-border'}`}>
          <Button size="sm" variant="ghost" className="h-auto w-full justify-start whitespace-normal rounded-none text-left"
            aria-expanded={!collapsed.has(block.id)} aria-controls={`change-${proposalId}-${block.id}`}
            onClick={() => { setSelected(block.id); setCollapsed(current => { const next = new Set(current); if (!next.delete(block.id)) next.add(block.id); return next; }); }}>
            <span className="min-w-0">修改 {block.id + 1} · {noteChangeKind(block)} · <span className="font-mono text-xs">−{block.beforeLine},{block.beforeCount} +{block.afterLine},{block.afterCount}</span></span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{collapsed.has(block.id) ? '展开' : '收起'}</span>
          </Button>
          <div id={`change-${proposalId}-${block.id}`} hidden={collapsed.has(block.id)}>
            {!collapsed.has(block.id) ? <NoteDiffLines block={block} /> : null}
          </div>
        </section>)}
    </div>
    <NoteReviewDecisionBar proposalId={proposalId} invalid={Boolean(result.error)} />
  </section>;
}
