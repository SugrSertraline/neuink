import { runLocalBackgroundJob } from '@/shared/lib/localBackgroundJobs';
import { Plus } from 'lucide-react';
import { PaperCardGroups } from './PaperCardGroups';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaperCardEditor } from './PaperCardEditor';
import { changeDraftCard, removePaperCard } from './paperCardOperations';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { SourceSnapshotPreview } from '@/shared/components/SourceSnapshotPreview';
import { readIdeationDraft, saveIdeationDraft, type IdeationDraftSnapshot, type PaperCard } from '@/shared/ipc/ideationApi';
import { useIdeationContext } from './IdeationContext';
import { compactCardLabels } from './cardPresentation';
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
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<PaperCard | null>(null);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const [editor, setEditor] = useState<{ card: PaperCard; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<PaperCard | null>(null);
  const [mutating, setMutating] = useState(false), [mutationError, setMutationError] = useState('');
  const pendingCollectionSave = useRef<string | null>(null);
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
  const confirmedIds = new Set(cards.filter(card => card.origin === 'ai_reviewed' || (acceptedIds.has(card.id) && card.origin !== 'ai_draft')).map(card => card.id));
  const visible = cards.filter(card => (filter === 'all' || card.kind === filter) && `${card.title} ${card.body}`.toLowerCase().includes(query.trim().toLowerCase()));
  const backgroundBusy = context.background.activeId === entryId;
  const changeCard = async (card: PaperCard, remove: boolean) => {
    if (mutating || busy || !snapshot || !context.collection) return;
    setMutating(true); setMutationError('');
    try {
      // Remove the draft copy first, so deleting an accepted card cannot reveal it again.
      if (snapshot.draft?.cards.some(item => item.id === card.id)) {
        const next = changeDraftCard(snapshot.draft, card.id, remove ? null : card);
        const saved = await saveIdeationDraft(root, snapshot.revision, next);
        setSnapshot(saved); await context.background.refresh();
      }
      if (acceptedIds.has(card.id) || editor?.isNew || pendingCollectionSave.current === card.id) {
        pendingCollectionSave.current = card.id;
        context.updateCollection(current => remove ? removePaperCard(current, card.id) : {
          ...current, cards: current.cards.some(item => item.id === card.id) ? current.cards.map(item => item.id === card.id ? card : item) : [...current.cards, card],
        });
        if (!await context.save()) throw new Error('save');
      }
      pendingCollectionSave.current = null; setEditor(null); setDeleting(null); setSelected(null);
    } catch { setMutationError('保存失败或数据已被其他窗口修改。当前编辑保留，请重试；读取冲突时先关闭后重新读取。'); }
    finally { setMutating(false); }
  };
  const confirming = useRef(false);
  const confirmCard = async (card: PaperCard) => {
    if (confirming.current || mutating || busy || backgroundBusy || !snapshot || !context.collection) return;
    confirming.current = true; setMutating(true); setMutationError('');
    const reviewed: PaperCard = { ...card, origin: 'ai_reviewed' };
    try {
      if (acceptedIds.has(card.id)) {
        context.updateCollection(current => ({ ...current, cards: current.cards.map(item => item.id === card.id ? { ...item, origin: 'ai_reviewed' } : item) }));
        try { if (!await context.save()) throw new Error('save'); }
        catch (cause) {
          context.updateCollection(current => ({ ...current, cards: current.cards.map(item => item.id === card.id ? { ...item, origin: card.origin } : item) }));
          throw cause;
        }
      } else if (snapshot.draft) {
        const saved = await saveIdeationDraft(root, snapshot.revision, changeDraftCard(snapshot.draft, card.id, reviewed));
        setSnapshot(saved);
        void context.background.refresh().catch(() => {});
      }
      setSelected(current => current?.id === card.id ? reviewed : current);
    } catch { setMutationError('确认保存失败，请重试；卡片内容保留。'); }
    finally { confirming.current = false; setMutating(false); }
  };
  const generate = async () => {
    if (busy || mutating || editor || deleting || !snapshot) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setError(''); setProgress('准备正文…');
    let writing = false;
    try {
      await runLocalBackgroundJob({ kind: 'llm', scope: { kind: 'entry', root, entry_id: entryId }, idPrefix: 'paper-cards',
        message: '正在整理论文卡片', successMessage: '论文卡片草稿已保存，请核对', failureMessage: '论文卡片整理未完成，已有内容保留',
      }, async report => {
      const result = await generatePaperCards(root, entryId, abort.signal, (done, total) => { if (!abort.signal.aborted) { setProgress(`整理 ${done}/${total} 批`); report({ current: done, total, percent: total > 0 ? done / total * 100 : 0 }); } });
      abort.signal.throwIfAborted();
      report({ current: 0, total: 0, percent: 0 }, { message: '正在保存论文卡片草稿' });
      writing = true; setSaving(true); setProgress('保存草稿…');
      const saved = await saveIdeationDraft(root, snapshot.revision, { entry_id: entryId, status: 'ready', model: result.model, partial: result.partial,
        cards: result.cards.map(card => ({ id: card.id, entry_id: entryId, kind: card.kind, title: card.title, body: card.body, sources: card.sources, pattern_ids: card.pattern_ids, origin: 'ai_draft' })), relations: result.relations ?? [] });
      if (!abort.signal.aborted) { setSnapshot(saved); await context.background.refresh(); }
      });
    } catch (cause) { if (!abort.signal.aborted) setError(writing ? '草稿保存失败，请刷新后重试；已有卡片保留。' : cardErrorMessages[classifyCardError(cause)]); }
    finally { if (!abort.signal.aborted) { setBusy(false); setSaving(false); setProgress(''); } if (controller.current === abort) controller.current = null; }
  };
  return <section className="min-w-0 space-y-4" aria-label="论文卡片">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">论文卡片 · {cards.length}</h3><div className="flex items-center gap-2"><Button size="sm" disabled={!context.collection || !snapshot || mutating || busy} onClick={() => { setMutationError(''); setEditor({ isNew: true, card: { id: crypto.randomUUID(), entry_id: entryId, kind: 'method', title: '', body: '', sources: [] } }); }}><Plus className="size-3.5" />新建卡片</Button><Button size="sm" variant="outline" disabled={!parsed || !snapshot || busy || backgroundBusy || mutating || Boolean(editor) || Boolean(deleting)} onClick={() => void generate()}>开始生成</Button></div></div>
    <p className="text-xs text-muted-foreground">仅此论文 · {confirmedIds.size} 张已确认 · {cards.length - confirmedIds.size} 张待核对</p>
    <p className="text-xs text-muted-foreground">只有点击“开始生成”才会调用 AI 整理论文卡片，进入页面不会自动生成。</p>
    {!parsed && <p className="text-xs text-muted-foreground">解析论文后可整理卡片，已有内容仍可查看。</p>}
    {(!snapshot && !error) && <p role="status" className="text-xs">正在读取论文卡片…</p>}
    {(busy || backgroundBusy) && <div role="status" className="flex items-center gap-2 text-xs">{busy ? progress : '正在后台整理此论文…'}{busy && !saving && <Button size="sm" variant="ghost" onClick={() => { controller.current?.abort(); setBusy(false); setProgress(''); }}>停止</Button>}</div>}
    {error && <div role="alert" className="text-xs text-destructive">{error}<Button size="sm" variant="ghost" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取</Button></div>}
    {draft?.status === 'failed' && <p className="text-xs text-destructive">上次整理失败：{cardErrorMessages[draft.error_code ?? 'model']}</p>}
    {draft?.partial && <p className="text-xs text-muted-foreground">草稿仅完成部分整理，请核对覆盖范围。</p>}
    {snapshot && !cards.length && !busy && <p className="text-xs text-muted-foreground">这篇论文暂无卡片。整理后可在这里核对抽象内容与原文实例。</p>}
    <div className="flex flex-wrap items-center gap-2"><SearchInput label="搜索论文卡片" placeholder="搜索名称与内容" value={query} onValueChange={setQuery} /><Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-32" aria-label="筛选卡片类型"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部类型</SelectItem>{Object.entries(compactCardLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><span className="text-xs text-muted-foreground">{visible.length} 张</span></div>
    {cards.length > 0 && !visible.length && <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的卡片，试试其他关键词或类型。</p>}
    <PaperCardGroups key={`${query}:${filter}`} cards={visible} acceptedIds={confirmedIds} onConfirm={card => void confirmCard(card)} disabled={mutating || busy || backgroundBusy}
      onView={setSelected} onEdit={card => { setMutationError(''); setEditor({ card, isNew: false }); }}
      onDelete={card => { setMutationError(''); setDeleting(card); }} />
    {mutationError && !editor && !deleting && <p role="alert" className="text-xs text-destructive">{mutationError}</p>}
    {editor && <PaperCardEditor key={editor.card.id} card={editor.card} isNew={editor.isNew} busy={mutating} error={mutationError} onSave={card => void changeCard(card, false)} onClose={() => setEditor(null)} />}
    <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open && !mutating) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>删除这张卡片？</DialogTitle><DialogDescription>将删除“{deleting?.title}”。{context.collection?.placements.filter(node => node.card_id === deleting?.id).length || 0} 个画布节点及其连线也会移除。论文和其他卡片保留。</DialogDescription></DialogHeader>{mutationError && <p role="alert" className="text-xs text-destructive">{mutationError}</p>}<DialogFooter><Button variant="outline" disabled={mutating} onClick={() => setDeleting(null)}>取消</Button><Button variant="destructive" disabled={mutating} onClick={() => deleting && void changeCard(deleting, true)}>{mutating ? '删除中…' : '确认删除'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent layout="bounded"><DialogHeader><DialogTitle>{selected?.title ?? '论文卡片'}</DialogTitle><DialogDescription>此论文的卡片内容与来源摘录；模型归纳需要核对。</DialogDescription></DialogHeader><DialogBody className="space-y-3">{selected && <><SourceSnapshotPreview markdown={selected.body} normalization="none" />{selected.sources?.map(source => <div key={source.segment_uid} className="border-t pt-2 text-xs"><p className="font-medium">来源 · 第 {source.page_idx + 1} 页</p><p className="whitespace-pre-wrap text-muted-foreground">{source.quote}</p></div>)}</>}</DialogBody><DialogFooter>{selected && !confirmedIds.has(selected.id) && <Button disabled={mutating || busy || backgroundBusy} onClick={() => void confirmCard(selected)}>{mutating ? '保存中…' : '确认已核对'}</Button>}</DialogFooter></DialogContent></Dialog>
  </section>;
}
