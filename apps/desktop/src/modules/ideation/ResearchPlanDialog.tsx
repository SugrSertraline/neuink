import { useIdeationTask } from './ideationTask';
import type { IdeationState } from '@/shared/ipc/ideationApi';
import { ginarExampleBrief } from './researchExampleBrief';
import { createEntry, createNote, readNote, updateNote } from '@/shared/ipc/workspaceApi';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { useIdeationContext } from './IdeationContext';
import { cardLabels } from './ideationUtils';
import { nodeCard } from './ideationBoards';
import { ResearchPlanError, researchInput, researchPlanMarkdown } from './researchPlan';
import { cardErrorMessages, classifyCardError } from './generateCards';
import { generateResearchPlan } from './generateResearchPlan';

/** Dialog owns temporary selection/results; the existing workspace owns accepted cards. */
export function ResearchPlanDialog({ root, onClose, worksheet }: { root: string; onClose: () => void; worksheet?: { goal: string; state: IdeationState; background: string; constraints: string } }) {
  const runTask=useIdeationTask();
  const context = useIdeationContext()!;
  const board = context.activeBoard!, state = worksheet?.state ?? context.state!;
  const [selected, setSelected] = useState(() => new Set(state.placements.filter(p => state.cards.find(c => c.id === p.card_id)?.origin !== 'ai_draft').map(p => p.id)));
  const [goal, setGoal] = useState(worksheet?.goal ?? (board.id === 'ginar-demo-board' ? ginarExampleBrief.goal : board.description || board.title));
  const [brief, setBrief] = useState(() => worksheet ? { background: worksheet.background, inputs: worksheet.constraints, outputs: '' } : board.id === 'ginar-demo-board' ? { background: ginarExampleBrief.background, inputs: ginarExampleBrief.inputs, outputs: ginarExampleBrief.outputs } : { background: '', inputs: '', outputs: '' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(''), [error, setError] = useState('');
  const [result, setResult] = useState<{ fingerprint: string; markdown: string } | null>(null);
  const [added, setAdded] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const input = researchInput(board, state, selected, goal, brief, Boolean(worksheet));
  const fingerprint = JSON.stringify(input);
  const stale = Boolean(result && result.fingerprint !== fingerprint);
  const generate = async () => {
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setBusy(true); setError(''); setResult(null); setProgress('准备研究…'); setEditing(false);
    try {
      await runTask({root,kind:'report',controller:abort},async stage=>{
      const response = await generateResearchPlan(root, input, abort.signal, text=>{setProgress(text);stage(text);});
      if (abort.signal.aborted) return;
      const markdown = researchPlanMarkdown(response.plan, input, response.model) + '\n\n## 来源核对\n\n' + response.evidenceStatus;
      if (new TextEncoder().encode(markdown).length > 90000) throw new ResearchPlanError('方案及输入快照过长，请减少卡片后重新研究。');
      setResult({ fingerprint, markdown });
      });
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof ResearchPlanError ? cause.message : cardErrorMessages[classifyCardError(cause)]);
    } finally { if (controller.current === abort) { setBusy(false); controller.current = null; } }
  };
  const reportTarget = useRef<{ entryId: string; noteId?: string } | null>(null);
  const accept = async () => {
    if (!result || !result.markdown.trim() || stale || saving || added) return;
    if (new TextEncoder().encode(result.markdown).length > 90000) { setError('报告过长，请缩减后保存。'); return; }
    setSaving(true); setError('');
    try {
      if (!reportTarget.current) {
        const entry = await createEntry(root, `研究报告：${board.title}`, { type: '研究报告' });
        reportTarget.current = { entryId: entry.id };
      }
      const target = reportTarget.current;
      if (!target.noteId) {
        const updated = await createNote(root, target.entryId, '研究方案报告');
        target.noteId = updated.contents[updated.contents.length - 1]?.note_id;
        if (!target.noteId) throw new Error('note');
      }
      const note = await readNote(root, target.entryId, target.noteId);
      await updateNote(root, target.entryId, target.noteId, '研究方案报告', result.markdown, undefined, note.revision);
      setAdded(true);
      setError('');
    } catch { setError('报告保存未完成，已创建的条目保留；请在关闭窗口前重试保存。'); }
    finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) { controller.current?.abort(); onClose(); } }}>
    <DialogContent layout="bounded" className="sm:max-w-[48rem]" onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader><DialogTitle>开始研究</DialogTitle><DialogDescription>围绕背景、研究问题和已选方法步骤开展研究。报告先供审阅，只有点击“确认并保存到条目”才写入资料库；不进行联网新颖性核查。</DialogDescription></DialogHeader>
      <DialogBody className="space-y-6 py-4">
        <label className="block space-y-2"><span className="text-sm font-semibold">研究目标</span><span className="block text-xs text-muted-foreground">说明想解决的问题、预期改进，以及需要满足的条件。</span><Textarea aria-label="研究目标" className="min-h-28 resize-y text-sm leading-6" placeholder="例如：在缺失数据条件下减少推理开销，同时保持预测精度。" value={goal} maxLength={4000} disabled={busy || saving || added} onChange={e => setGoal(e.target.value)} /></label>
        <div className="space-y-4">{([
          ['background', '问题背景', '研究场景、已有进展与约束，可选。'],
          ['inputs', '已有输入', '例如数据、文献范围、方法输入或分析依据，可选。'],
          ['outputs', '期望输出', '例如方法设计、综述、分析报告或技术路线，可选。'],
        ] as const).map(([key, label, placeholder]) => <label key={key} className="block space-y-2"><span className="text-sm font-semibold">{label}</span><Textarea aria-label={label} placeholder={placeholder} value={brief[key]} maxLength={4000} disabled={busy || saving || added} onChange={event => setBrief(current => ({ ...current, [key]: event.target.value }))} className="min-h-20 resize-y text-sm leading-6" /></label>)}</div>
        <div className="flex items-center gap-2"><span className="mr-auto">参与卡片 {input.cards.length}/40</span><Button size="sm" variant="outline" disabled={busy || saving || added} onClick={() => setSelected(new Set(state.placements.filter(p => state.cards.find(c => c.id === p.card_id)?.origin !== 'ai_draft').map(p => p.id)))}>全选</Button><Button size="sm" variant="ghost" disabled={busy || saving || added} onClick={() => setSelected(new Set())}>清空选择</Button></div>
        <div className="max-h-64 divide-y overflow-y-auto rounded-lg border bg-background">{state.placements.map(node => {
          const stored = state.cards.find(c => c.id === node.card_id); if (!stored) return null;
          const card = nodeCard(node, stored);
          return <label key={node.id} className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/40"><Checkbox checked={selected.has(node.id)} disabled={busy || saving || added || card.origin === 'ai_draft'} onCheckedChange={checked => setSelected(current => { const next = new Set(current); if (checked === true) next.add(node.id); else next.delete(node.id); return next; })} /><span className="min-w-0"><span className="block truncate" title={card.title}>{card.title}</span><span className="text-xs text-muted-foreground">{card.origin === 'ai_draft' ? '待核对，确认后可用于研究 · ' : ''}{cardLabels[card.kind]} · {card.sources?.length ?? 0} 个来源</span></span></label>;
        })}</div>
        {busy && <p role="status" className="text-muted-foreground">{progress}</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {stale && <p role="status" className="text-destructive">卡片、关系或研究说明已改变，请重新研究后保存。</p>}
        {result && <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{added ? '已保存的研究报告' : '报告草稿 · 尚未保存到条目'}</h3><Button variant="outline" size="sm" disabled={saving || added} onClick={() => setEditing(value => !value)}>{editing ? '预览报告' : '修改报告'}</Button></div>{editing ? <Textarea aria-label="报告正文" className="min-h-80 font-mono text-sm" value={result.markdown} disabled={saving || added} onChange={event => setResult(current => current && ({ ...current, markdown: event.target.value }))} /> : <SourceSnapshotPreview markdown={result.markdown} normalization="none" />}</section>}
        {!added && <p className="text-xs text-muted-foreground">研究说明与报告草稿仅保留在当前窗口。关闭将放弃未保存内容；确认保存后才创建研究报告条目。</p>}
      </DialogBody>
      <DialogFooter><Button variant="outline" disabled={saving} onClick={() => { controller.current?.abort(); onClose(); }}>关闭</Button>{busy ? <Button variant="outline" onClick={() => { controller.current?.abort(); setProgress('已停止'); }}>停止研究</Button> : <Button disabled={added || saving || !goal.trim() || !input.cards.length || input.cards.length > 40} onClick={() => void generate()}>{result ? '重新研究' : '开始研究'}</Button>}<Button disabled={!result?.markdown.trim() || stale || busy || saving || added} onClick={() => void accept()}>{saving ? '保存中…' : added ? '已保存到新条目' : '确认并保存到条目'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
