import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useIdeationContext } from './IdeationContext';
import { researchInput, ResearchPlanError } from './researchPlan';
import { linkLabels } from './ideationBoards';
import { cardErrorMessages, classifyCardError } from './generateCards';
import { applyRelationSuggestions, generateRelationSuggestions, type RelationSuggestion } from './relationSuggestions';

/** A compact canvas review bar: proposals never write until explicitly accepted. */
export function RelationSuggestionsPanel({ onPreview, onClose, onResearch }: {
  onPreview: (links: RelationSuggestion[]) => void; onClose: () => void; onResearch: () => void;
}) {
  const context = useIdeationContext()!, board = context.activeBoard!, state = context.state!;
  const makeInput = (graph: typeof state) => researchInput(board, graph, new Set(graph.placements.filter(p => graph.cards.find(c => c.id === p.card_id)?.origin !== 'ai_draft').map(p => p.id)), board.description || board.title);
  const input = makeInput(state), fingerprint = JSON.stringify(input);
  const [queue, setQueue] = useState<RelationSuggestion[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [done, setDone] = useState(false), [reviewed, setReviewed] = useState(0);
  const expected = useRef(fingerprint), abort = useRef<AbortController | null>(null);
  const current = queue[0], stale = expected.current !== fingerprint;
  const generate = async () => {
    const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
    expected.current = fingerprint; setBusy(true); setError(''); setQueue([]); setDone(false); setReviewed(0);
    try { const links = await generateRelationSuggestions(input, controller.signal); if (!controller.signal.aborted) { setQueue(links); setDone(true); } }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof ResearchPlanError ? cause.message : cardErrorMessages[classifyCardError(cause)]); }
    finally { if (abort.current === controller) { setBusy(false); abort.current = null; } }
  };
  useEffect(() => { void generate(); return () => { abort.current?.abort(); onPreview([]); }; }, []);
  useEffect(() => { onPreview(current && !stale ? [{ ...current, label: `${current.action === 'delete' ? '删除' : current.action === 'modify' ? '修改' : '新增'} · ${linkLabels[current.kind ?? 'related']}` }] : []); }, [current, stale, onPreview]);
  const next = (accept: boolean) => {
    if (!current || stale) return;
    if (accept) context.update(graph => { const updated = applyRelationSuggestions(graph, [current]); expected.current = JSON.stringify(makeInput(updated)); return updated; });
    setQueue(items => items.slice(1)); setReviewed(value => value + 1);
  };
  return <div role="region" aria-label="画布关系审阅" className="absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-md">
    {busy ? <><span role="status" className="text-xs">正在分析关系…</span><Button size="sm" variant="outline" onClick={onClose}>停止</Button></> : error || stale ? <><span role="alert" className="text-xs text-destructive">{stale ? '画布已变化，请重新分析' : error}</span><Button size="sm" onClick={() => void generate()}>重新分析</Button></> : current ? <><span className="text-xs">{reviewed + 1} / {reviewed + queue.length} · {current.action === 'delete' ? '建议删除' : current.action === 'modify' ? '建议修改' : '建议新增'}</span><Button size="sm" onClick={() => next(true)}>确认此项</Button><Button size="sm" variant="outline" onClick={() => next(false)}>跳过</Button></> : <><span role="status" className="text-xs">{done ? '关系审阅完成' : '准备分析'}</span><Button size="sm" onClick={onResearch}>开始研究</Button></>}
    <Button size="sm" variant="ghost" onClick={onClose}>退出审阅</Button>
  </div>;
}
