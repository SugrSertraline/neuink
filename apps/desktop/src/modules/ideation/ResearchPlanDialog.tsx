import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { useIdeationContext } from './IdeationContext';
import { cardLabels, placeCard, userEntryId } from './ideationUtils';
import { nodeCard } from './ideationBoards';
import { ResearchPlanError, researchInput, researchPlanMarkdown } from './researchPlan';
import { cardErrorMessages, classifyCardError } from './generateCards';
import { generateResearchPlan } from './generateResearchPlan';

/** Dialog owns temporary selection/results; the existing workspace owns accepted cards. */
export function ResearchPlanDialog({ root, onClose }: { root: string; onClose: () => void }) {
  const context = useIdeationContext()!;
  const board = context.activeBoard!, state = context.state!;
  const [selected, setSelected] = useState(() => new Set(state.placements.map(p => p.id)));
  const [goal, setGoal] = useState(board.description || board.title);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(''), [error, setError] = useState('');
  const [result, setResult] = useState<{ fingerprint: string; markdown: string } | null>(null);
  const [added, setAdded] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const input = researchInput(board, state, selected, goal);
  const fingerprint = JSON.stringify(input);
  const stale = Boolean(result && result.fingerprint !== fingerprint);
  const generate = async () => {
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setBusy(true); setError(''); setResult(null); setProgress('准备评价…');
    try {
      const response = await generateResearchPlan(root, input, abort.signal, setProgress);
      if (abort.signal.aborted) return;
      const markdown = researchPlanMarkdown(response.plan, input, response.model) + '\n\n## 来源核对\n\n' + response.evidenceStatus;
      if (new TextEncoder().encode(markdown).length > 90000) throw new ResearchPlanError('方案及输入快照过长，请减少卡片后重新评价。');
      setResult({ fingerprint, markdown });
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof ResearchPlanError ? cause.message : cardErrorMessages[classifyCardError(cause)]);
    } finally { if (controller.current === abort) { setBusy(false); controller.current = null; } }
  };
  const accept = async () => {
    if (!result || stale || saving) return;
    setSaving(true); setError('');
    if (!added) {
      placeCard(context.update, { id: crypto.randomUUID(), entry_id: userEntryId, kind: 'idea', origin: 'ai_draft',
        title: `研究方案：${board.title}`.slice(0, 150), body: result.markdown, sources: [] }, 80, 80);
      setAdded(true);
    }
    try {
      if (await context.save()) onClose();
      else setError('保存失败，方案仍在当前画布中；请重试保存。');
    } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) { controller.current?.abort(); onClose(); } }}>
    <DialogContent layout="bounded" className="sm:max-w-[48rem]" onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader><DialogTitle>评价组合与研究方案</DialogTitle><DialogDescription>选择参与组合的卡片，明确目标。模型只生成待审阅方案，不会自动修改画布；不进行联网新颖性核查。</DialogDescription></DialogHeader>
      <DialogBody className="space-y-4">
        <label className="block space-y-2"><span>研究目标</span><Textarea value={goal} maxLength={4000} disabled={busy || added} onChange={e => setGoal(e.target.value)} /></label>
        <div className="flex items-center gap-2"><span className="mr-auto">参与卡片 {input.cards.length}/40</span><Button size="sm" variant="outline" disabled={busy || added} onClick={() => setSelected(new Set(state.placements.map(p => p.id)))}>全选</Button><Button size="sm" variant="ghost" disabled={busy || added} onClick={() => setSelected(new Set())}>清空选择</Button></div>
        <div className="divide-y rounded-md border">{state.placements.map(node => {
          const stored = state.cards.find(c => c.id === node.card_id); if (!stored) return null;
          const card = nodeCard(node, stored);
          return <label key={node.id} className="flex items-start gap-3 px-3 py-2"><Checkbox checked={selected.has(node.id)} disabled={busy || added} onCheckedChange={checked => setSelected(current => { const next = new Set(current); if (checked === true) next.add(node.id); else next.delete(node.id); return next; })} /><span className="min-w-0"><span className="block truncate" title={card.title}>{card.title}</span><span className="text-xs text-muted-foreground">{cardLabels[card.kind]} · {card.sources?.length ?? 0} 个来源</span></span></label>;
        })}</div>
        {busy && <p role="status" className="text-muted-foreground">{progress}</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {stale && <p role="status" className="text-destructive">卡片、关系或目标已改变，请重新评价后保存。</p>}
        {result && <SourceSnapshotPreview markdown={result.markdown} normalization="none" />}
      </DialogBody>
      <DialogFooter><Button variant="outline" disabled={saving} onClick={() => { controller.current?.abort(); onClose(); }}>关闭</Button>{busy ? <Button variant="outline" onClick={() => { controller.current?.abort(); setProgress('已停止'); }}>停止评价</Button> : <Button disabled={added || saving || !goal.trim() || !input.cards.length || input.cards.length > 40} onClick={() => void generate()}>{result ? '重新评价' : '评价并生成方案'}</Button>}<Button disabled={!result || stale || busy || saving} onClick={() => void accept()}>{saving ? '保存中…' : added ? '重试保存' : '保存为方案卡'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
