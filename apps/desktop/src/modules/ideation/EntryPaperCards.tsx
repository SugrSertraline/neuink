import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { readIdeationDraft, saveIdeationDraft, type IdeationDraftSnapshot, type PaperCard } from '@/shared/ipc/ideationApi';
import { useIdeationContext } from './IdeationContext';
import { cardSummary, compactCardLabels } from './cardPresentation';
import { cardErrorMessages, classifyCardError, generatePaperCards } from './generateCards';

export function EntryPaperCards({ entryId, parsed }: { entryId: string; parsed: boolean }) {
  const context = useIdeationContext();
  return context ? <PaperCards key={`${context.workspaceRoot}:${entryId}`} entryId={entryId} parsed={parsed} /> : null;
}
function PaperCards({ entryId, parsed }: { entryId: string; parsed: boolean }) {
  const context = useIdeationContext()!, root = context.workspaceRoot;
  const [snapshot, setSnapshot] = useState<IdeationDraftSnapshot | null>(null);
  const [error, setError] = useState(''), [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0), [limit, setLimit] = useState(6);
  const [selected, setSelected] = useState<PaperCard | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const revision = context.background.summaries?.find(item => item.entry_id === entryId)?.revision;
  useEffect(() => {
    let live = true;
    setError('');
    void readIdeationDraft(root, entryId).then(value => { if (live) setSnapshot(value); })
      .catch(() => { if (live) setError('论文卡片读取失败，请重试。'); });
    return () => { live = false; };
  }, [root, entryId, revision, reload]);
  const accepted = (context.collection?.cards ?? []).filter(card => card.entry_id === entryId);
  const acceptedIds = new Set(accepted.map(card => card.id));
  const draft = snapshot?.draft;
  const cards = [...accepted, ...(draft?.status === 'ready' ? draft.cards.filter(card => card.entry_id === entryId && !acceptedIds.has(card.id)) : [])];
  const backgroundBusy = context.background.activeId === entryId;
  const generate = async () => {
    if (busy || !snapshot) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError(''); setProgress('准备正文…');
    let writing = false;
    try {
      const result = await generatePaperCards(root, entryId, abort.signal, (done, total) => { if (!abort.signal.aborted) setProgress(`整理 ${done}/${total} 批`); });
      if (abort.signal.aborted) return;
      writing = true; setSaving(true); setProgress('保存草稿…');
      const saved = await saveIdeationDraft(root, snapshot.revision, { entry_id: entryId, status: 'ready', model: result.model, partial: result.partial,
        cards: result.cards.map(card => ({ id: card.id, entry_id: entryId, kind: card.kind, title: card.title, body: card.body, sources: card.sources, pattern_ids: card.pattern_ids, origin: 'ai_draft' })), relations: result.relations ?? [] });
      if (!abort.signal.aborted) { setSnapshot(saved); await context.background.refresh(); }
    } catch (cause) { if (!abort.signal.aborted) setError(writing ? '草稿保存失败，请刷新后重试；已有卡片保留。' : cardErrorMessages[classifyCardError(cause)]); }
    finally { if (!abort.signal.aborted) { setBusy(false); setSaving(false); setProgress(''); } if (controller.current === abort) controller.current = null; }
  };
  return <section className="min-w-0 space-y-2 rounded-md border p-3" aria-label="论文卡片">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">论文卡片 · {cards.length}</h3><Button size="sm" variant="outline" disabled={!parsed || !snapshot || busy || backgroundBusy} onClick={() => void generate()}>{cards.length ? '重新整理' : '整理卡片'}</Button></div>
    <p className="text-xs text-muted-foreground">仅此论文 · {accepted.length} 张已采纳 · {cards.length - accepted.length} 张待核对</p>
    {!parsed && <p className="text-xs text-muted-foreground">解析论文后可整理卡片，已有内容仍可查看。</p>}
    {(!snapshot && !error) && <p role="status" className="text-xs">正在读取论文卡片…</p>}
    {(busy || backgroundBusy) && <div role="status" className="flex items-center gap-2 text-xs">{busy ? progress : '正在后台整理此论文…'}{busy && !saving && <Button size="sm" variant="ghost" onClick={() => { controller.current?.abort(); setBusy(false); setProgress(''); }}>停止</Button>}</div>}
    {error && <div role="alert" className="text-xs text-destructive">{error}<Button size="sm" variant="ghost" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取</Button></div>}
    {draft?.status === 'failed' && <p className="text-xs text-destructive">上次整理失败：{cardErrorMessages[draft.error_code ?? 'model']}</p>}
    {draft?.partial && <p className="text-xs text-muted-foreground">草稿仅完成部分整理，请核对覆盖范围。</p>}
    {snapshot && !cards.length && !busy && <p className="text-xs text-muted-foreground">这篇论文暂无卡片。整理后可在这里核对抽象内容与原文实例。</p>}
    <div className="divide-y">{cards.slice(0, limit).map(card => <button key={card.id} className="block w-full space-y-1 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelected(card)}>
      <span className="block text-xs text-muted-foreground">{compactCardLabels[card.kind]} · {acceptedIds.has(card.id) ? '已采纳' : '待核对'}</span><span className="line-clamp-2 text-sm font-medium">{card.title}</span><span className="line-clamp-2 text-xs text-muted-foreground">{cardSummary(card)}</span>
    </button>)}</div>
    {cards.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimit(value => value + 12)}>显示更多卡片（剩余 {cards.length - limit}）</Button>}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent layout="bounded"><DialogHeader><DialogTitle>{selected?.title ?? '论文卡片'}</DialogTitle><DialogDescription>此论文的卡片内容与来源摘录；模型归纳需要核对。</DialogDescription></DialogHeader><DialogBody className="space-y-3">{selected && <><SourceSnapshotPreview markdown={selected.body} normalization="none" />{selected.sources?.map(source => <div key={source.segment_uid} className="border-t pt-2 text-xs"><p className="font-medium">来源 · 第 {source.page_idx + 1} 页</p><p className="whitespace-pre-wrap text-muted-foreground">{source.quote}</p></div>)}</>}</DialogBody></DialogContent></Dialog>
  </section>;
}
