import { WorksheetRecommendations } from './WorksheetRecommendations';
import { addWorksheetCard, sectionForNode, worksheetSections } from './researchWorksheet';
import { fieldForKind } from './researchWorksheet';
import { CardTypeLabel } from './CardTypeLabel';
import { compactCardLabels } from './cardPresentation';
import { cardTemplateText } from './cardTemplates';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { SourceLinkOpenTarget } from '@/modules/notes/editor/SourceLinkNode';
import { registerSegmentEditorCloseHandler, setSegmentEditorDirty } from '@/modules/reader/components/segmentEditorDirtyRegistry';
import { readIdeationDraft, type CardKind } from '@/shared/ipc/ideationApi';
import { useIdeationContext } from './IdeationContext';
import type { CardGeneration } from './generateCards';
import { cardLabels, placeCard, placeDraftCard, presetCards, presetEntryId, userEntryId } from './ideationUtils';
import { researchPatterns, researchStudioLicense, researchStudioUrl } from './patterns/researchPatterns';
import { SourceEvidence } from './SourceEvidence';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PaperCardBody } from './PaperCardBody';
import { useSidebarDraftCards } from './useSidebarDraftCards';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody } from '@/components/ui/dialog';
import { IdeationBoardList, IdeationBoardDialog } from './IdeationBoardList';
import { usePointerItemDrag } from '@/shared/lib/usePointerItemDrag';
import { PointerPreview } from '@/components/ui/pointer-preview';
import { ideationCardDrag, type IdeationDragItem } from './ideationDrag';
import { candidateKinds } from './ideationBranches';

export function IdeationSidebar({ root, entries, onOpenEntry, onOpenSource, onOpenCards }: {
  root: string; entries: LibraryEntry[]; onOpenCards?: (id: string) => void; onOpenEntry: (id: string) => void; onOpenSource: (target: SourceLinkOpenTarget) => void;
}) {
  const context = useIdeationContext();
  const openCardManager = onOpenCards ?? onOpenEntry;
  const drag = usePointerItemDrag<IdeationDragItem>(`${root}:${context?.activeBoard?.id}:${context?.sidebarTab}`, ideationCardDrag);
  const candidatePanel = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [source, setSource] = useState('all');
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [limit, setLimit] = useState(30);
  const fullDraftCards = useSidebarDraftCards(root, context?.background.summaries ?? [], limit);
  const [generation, setGeneration] = useState<CardGeneration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState(false);
  const [paperQuery, setPaperQuery] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<CardKind>('problem');
  const entriesById = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);
  useEffect(() => { setLimit(30); }, [query, filter, context?.selectedSlot]);
  useEffect(() => {
    if (context?.cardRequest) { setKind(context.cardRequest.kind); if (!title.trim() && !body.trim()) setEntryId(''); setManual(true); }
  }, [context?.cardRequest]);
  useEffect(() => { setQuery(''); setFilter(context?.branchTarget?.kinds.length === 1 ? context.branchTarget.kinds[0] : context?.selectedSlot ?? 'all'); setSource('all'); setLimit(30); if (candidatePanel.current) candidatePanel.current.scrollTop = 0; }, [context?.candidateRequest, context?.branchSourceId, context?.branchTarget?.id, context?.activeBoard?.id, context?.selectedSlot]);
  useEffect(() => {
    const owner = `ideation-draft:${root}`;
    const dirty = Boolean(title.trim() || body.trim() || generation);
    setSegmentEditorDirty('ideation', owner, dirty);
    const unregister = registerSegmentEditorCloseHandler('ideation', owner, {
      save: async () => false,
      discard: () => { setTitle(''); setBody(''); setGeneration(null); }
    });
    return () => { unregister(); setSegmentEditorDirty('ideation', owner, false); };
  }, [root, title, body, generation]);
  if (!context) return <aside className="app-sidebar p-3 text-xs">请先打开资料库。</aside>;
  const { state, update, entryId, setEntryId, selectedCardId, setSelectedCardId, selectedSlot, selectSlot, background } = context;
  const accepted = new Set(state?.cards.map(card => card.id) ?? []);
  const search = query.trim().toLowerCase();
  const matches = (text: string) => !search || text.toLowerCase().includes(search);
  const branchNode = state?.placements.find(p => p.id === context.branchSourceId);
  const branchCard = state?.cards.find(c => c.id === branchNode?.card_id);
  const allowedKinds = context.worksheetSection ? null : context.branchTarget?.kinds ?? (selectedSlot ? (Object.keys(cardLabels) as CardKind[]).filter(kind => fieldForKind(kind) === fieldForKind(selectedSlot)) : branchCard ? candidateKinds(branchCard.kind) : null);
  const matchesKind = (cardKind: CardKind) => (!allowedKinds || allowedKinds.includes(cardKind)) && (filter === 'all' || filter === cardKind || (filter === selectedSlot && !context.branchTarget && fieldForKind(cardKind) === fieldForKind(selectedSlot)));
  const savedCards = (state?.cards ?? []).filter(card => !card.id.startsWith('local-idea-') && matchesKind(card.kind) && matches(`${card.title} ${card.body} ${entriesById.get(card.entry_id)?.title ?? ''} ${(entriesById.get(card.entry_id)?.tags ?? []).join(' ')}`));
  const presets = presetCards.filter(card => !accepted.has(card.id) && matchesKind(card.kind) && matches(`${card.title} ${card.body} 解决方向`));
  const drafts = (background.summaries ?? []).flatMap(record => record.status === 'ready' ? record.cards.map(card => fullDraftCards.get(card.id) ?? card).filter(card => !accepted.has(card.id) && matchesKind(card.kind) && matches(`${card.title} ${card.body ?? ''} ${entriesById.get(record.entry_id)?.title ?? ''}`)).map(card => ({ ...card, entryId: record.entry_id })) : []);
  const rows = [...savedCards.filter(card => source === 'all' || (source === 'patterns' ? card.entry_id === presetEntryId : source === 'personal' ? card.entry_id === userEntryId : card.entry_id !== presetEntryId && card.entry_id !== userEntryId)).map(card => ({ type: 'saved' as const, card })), ...(['all', 'papers'].includes(source) ? drafts.map(card => ({ type: 'draft' as const, card })) : []), ...(['all', 'patterns'].includes(source) ? presets.map(card => ({ type: 'preset' as const, card })) : [])];
  const targetFor = (cardKind: CardKind) => context.branchSlots.find(slot => context.branchTarget ? slot.id === context.branchTarget.id : slot.kinds.includes(cardKind));
  const sectionLabel = worksheetSections.find(f => f.key === context.worksheetSection)?.label;
  const alreadyAdded = (id: string) => Boolean(context.worksheetSection && state?.placements.some(p => { const card=state.cards.find(c=>c.id===p.card_id); return p.card_id===id && card && sectionForNode({...p,card})===context.worksheetSection; }));
  const addLabel = context.worksheetSection ? `加入${sectionLabel}` : context.branchTarget ? '填入空位' : branchNode ? '接入分支' : '加入方案';
  const dragProps = (data: string, card: { title: string; kind: CardKind }) => {
    const item = { workspaceRoot: root, boardId: context.activeBoard?.id ?? '', data, title: card.title, kind: card.kind, x: 0, y: 0 };
    return { ...drag.handlers(item), onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (!context.activeBoard || ('origin' in card && card.origin === 'ai_draft') || (data.startsWith('draft:') && (!('origin' in card) || card.origin !== 'ai_reviewed'))) return;
      // Worksheet uses explicit Add buttons; dragging must not capture text selection.
    }, onClickCapture: (event: React.MouseEvent<HTMLElement>) => { if (drag.consumeDragClick()) { event.preventDefault(); event.stopPropagation(); } },
    draggable: false, onDragStart: (event: React.DragEvent) => event.preventDefault() };
  };
  const titleDrag = (data: string, card: { title: string; kind: CardKind }) => (event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation(); dragProps(data, card).onPointerDown(event);
  };
  const openDraft = async (id: string) => {
    if (loading || generation) return;
    setLoading(true); setError(null);
    try {
      const result = await readIdeationDraft(root, id);
      if (!result.draft || result.draft.status !== 'ready') throw new Error('草稿已更改，请刷新。');
      setGeneration({ entryId: id, model: result.draft.model, partial: result.draft.partial, relations: result.draft.relations ?? [],
        cards: result.draft.cards.filter(card => !accepted.has(card.id)).map(card => ({ ...card, sources: card.sources ?? [], selected: true })) });
    } catch { setError('读取草稿失败，请刷新后重试。'); }
    finally { setLoading(false); }
  };
  const accept = () => {
    if (!generation) return;
    const chosen = generation.cards.filter(card => card.selected && card.title.trim() && card.body.trim());
    update(current => { const ids = new Set(current.cards.map(card => card.id)); return { ...current, cards: [...current.cards, ...chosen.filter(card => !ids.has(card.id)).map(card => ({ id: card.id, entry_id: generation.entryId, kind: card.kind, title: card.title.trim(), body: card.body.trim(), sources: card.sources, pattern_ids: card.pattern_ids, origin: 'ai_reviewed' as const }))] }; });
    setGeneration(null);
  };
  const addStructure = () => {
    if (!generation) return;
    const chosen = generation.cards.filter(card => card.selected && card.title.trim() && card.body.trim());
    if (!chosen.length) return;
    update(current => {
      const existing = new Set(current.cards.map(card => card.id));
      const placements = chosen.map((card, index) => { const count = index + current.placements.length; return { id: crypto.randomUUID(), card_id: card.id, x: 70 + (count % 3) * 340, y: 70 + Math.floor(count / 3) * 270 }; });
      const positionByCard = new Map(placements.map(placement => [placement.card_id, placement.id]));
      const links = (generation.relations ?? []).flatMap(relation => {
        const from = positionByCard.get(relation.from), to = positionByCard.get(relation.to);
        return from && to ? [{ id: crypto.randomUUID(), from, to, kind: relation.kind, origin: 'ai_inferred' as const, entry_id: generation.entryId, sources: relation.sources }] : [];
      });
      return { ...current, cards: [...current.cards, ...chosen.filter(card => !existing.has(card.id)).map(card => ({ id: card.id, entry_id: generation.entryId, kind: card.kind, title: card.title.trim(), body: card.body.trim(), sources: card.sources, pattern_ids: card.pattern_ids, origin: 'ai_reviewed' as const }))], placements: [...current.placements, ...placements], links: [...(current.links ?? []), ...links] };
    });
    setGeneration(null);
  };
  const changeSuggestion = (id: string, change: Partial<CardGeneration['cards'][number]>) => setGeneration(current => current ? { ...current, cards: current.cards.map(card => card.id === id ? { ...card, ...change } : card) } : current);
  const nextPosition = () => { const count = state?.placements.length ?? 0; return { x: 70 + (count % 3) * 340, y: 100 + Math.floor(count / 3) * 270 }; };
  const add = (id: string) => {
    const card = state?.cards.find(item => item.id === id); if (!card) return;
    if (card.origin === 'ai_draft') { setError('请先在论文卡片中核对并确认。'); openCardManager(card.entry_id); return; }
    if (context.worksheetSection) { const section=context.worksheetSection;update(current=>addWorksheetCard(current,card,section));return; }
    const p = nextPosition(), target = targetFor(card.kind); placeCard(update, card, p.x, p.y, target); context.completeBranchTarget(target);
  };
  const addDraft = async (paperId: string, cardId: string, cardKind: CardKind) => {
    if (loading) return;
    const p = nextPosition(), target = targetFor(cardKind);
    setLoading(true); setError(null);
    try { if (context.worksheetSection) { const section=context.worksheetSection;const snapshot=await readIdeationDraft(root,paperId);const card=snapshot.draft?.cards.find(c=>c.id===cardId);if (!card || card.origin!=='ai_reviewed') throw new Error('未确认');update(current=>addWorksheetCard(current,card,section)); } else { await placeDraftCard(root, update, paperId, cardId, p.x, p.y, target);context.completeBranchTarget(target); } }
    catch { setError('添加草稿失败：请确认卡片类型或刷新后重试。'); }
    finally { setLoading(false); }
  };
  const entry = entriesById.get(entryId);
  return <aside className="app-sidebar" aria-label="研究构思侧栏">
    <div className="side-head gap-1">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold"><button className="rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={context.sidebarTab === 'boards' ? '构思列表，切换到卡片库' : '卡片库，切换到构思列表'} onClick={() => context.setSidebarTab(context.sidebarTab === 'boards' ? 'cards' : 'boards')}>{context.sidebarTab === 'boards' ? '构思列表' : '卡片库'}</button></h2>
      <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="outline" aria-label={context.sidebarTab === 'boards' ? '切换到卡片库' : '切换到构思列表'} onClick={() => context.setSidebarTab(context.sidebarTab === 'boards' ? 'cards' : 'boards')}><ArrowLeftRight className="size-4" /></Button></TooltipTrigger><TooltipContent>{context.sidebarTab === 'boards' ? '切换到卡片库' : '切换到构思列表'}</TooltipContent></Tooltip>
      <Button className="shrink-0" size="icon-sm" variant="ghost" disabled={!state} aria-label={context.sidebarTab === 'boards' ? '新建构思' : '新建卡片'} title={context.sidebarTab === 'boards' ? '新建构思' : '新建卡片'} onClick={() => context.sidebarTab === 'boards' ? setCreatingBoard(true) : context.requestCard(allowedKinds?.[0] ?? 'problem')}><Plus /></Button>
    </div>
    <div className="min-h-0 flex-1" role="region" aria-label="构思列表面板" hidden={context.sidebarTab !== 'boards'}><IdeationBoardList /></div>
    <div ref={candidatePanel} hidden={context.sidebarTab !== 'cards'} role="region" aria-label="卡片库面板" className="min-h-0 min-w-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto p-3">
      {context.activeBoard ? <p className="truncate text-xs text-muted-foreground" title={context.activeBoard.title}>加入：{context.activeBoard.title} · 点击卡片旁的加入按钮</p> : <p className="text-xs text-muted-foreground">先在构思列表创建构思，再组合卡片。</p>}
      {!state ? <p role={context.error ? 'alert' : 'status'} className="text-xs text-muted-foreground">{context.error ? `卡片读取失败：${context.error}` : '正在读取卡片…'}</p> : <>
        {context.branchTarget && <div className="space-y-1 border-b pb-2" role="status"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 text-sm font-medium">填入：{context.branchTarget.title}</span><Button size="sm" variant="ghost" onClick={() => selectSlot(null)}>全部卡片</Button></div><p className="text-xs text-muted-foreground">仅显示可填入的{context.branchTarget.kinds.map(kind => compactCardLabels[kind]).join('、')} · 类型匹配，适用性需核对</p></div>}
        {context.worksheetSection && context.activeBoard && <WorksheetRecommendations key={`${context.activeBoard.id}:${context.worksheetSection}:${context.candidateRequest}`} section={context.worksheetSection} />}
        <div className="flex items-center gap-2 border-t pt-3"><h3 className="mr-auto text-sm font-semibold">全部卡片</h3>{sectionLabel && <span className="text-xs text-muted-foreground">添加到：{sectionLabel}</span>}</div>
        <SearchInput label="搜索卡片" placeholder={allowedKinds ? '在这些候选卡片中搜索' : '搜索卡片内容或来源论文'} value={query} onValueChange={setQuery} />
        <div className="grid grid-cols-2 gap-2"><Select value={source} onValueChange={setSource}><SelectTrigger size="sm" className="w-full" aria-label="卡片来源"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部来源</SelectItem><SelectItem value="papers">来自论文</SelectItem><SelectItem value="personal">自行创建</SelectItem><SelectItem value="patterns">研究模式</SelectItem></SelectContent></Select>
        <Select value={filter} onValueChange={setFilter}><SelectTrigger size="sm" className="w-full" aria-label="筛选卡片类型"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{allowedKinds ? '可用类型' : '全部类型'}</SelectItem>{Object.entries(cardLabels).filter(([value]) => !allowedKinds || allowedKinds.includes(value as CardKind)).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>

        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {loading && <p role="status" className="text-xs text-muted-foreground">正在读取卡片…</p>}
        <Dialog open={Boolean(generation)} onOpenChange={open => { if (!open) setGeneration(null); }}><DialogContent layout="bounded"><DialogHeader><DialogTitle>核对论文卡片</DialogTitle><DialogDescription>核对内容与原文后，选择保存或加入当前构思。</DialogDescription></DialogHeader><DialogBody>{generation && <section aria-label="AI 卡片草稿" className="space-y-2">
          <div className="text-xs font-medium">核对草稿 · {entriesById.get(generation.entryId)?.title ?? '论文'}</div>
          <p className="text-xs text-muted-foreground">模型：{generation.model}。{generation.partial ? '仅完成部分整理（旧草稿可能仅分析了部分正文，或本次有失败批次／达到 300 张上限），请核对覆盖范围；成功结果已保留。' : '已分析提供的正文。'}请核对来源后添加；重新整理的结果在添加前是临时预览，旧草稿保留。</p>
          {(generation.relations?.length ?? 0) > 0 && <p className="text-xs text-muted-foreground">识别到 {generation.relations?.length} 条关系，仅作为来源记录保留；关系为 AI 归纳，需核对。</p>}
          {generation.cards.map(card => <div key={card.id} className="space-y-1 rounded border bg-background p-2 text-xs">
            <label className="flex items-center gap-2"><Checkbox checked={card.selected} onCheckedChange={checked => changeSuggestion(card.id, { selected: checked === true })} />{cardLabels[card.kind]}</label>
            <Input aria-label={`草稿标题 ${card.id}`} value={card.title} onChange={e => changeSuggestion(card.id, { title: e.target.value })} />
            <Textarea aria-label={`草稿内容 ${card.id}`} value={card.body} onChange={e => changeSuggestion(card.id, { body: e.target.value })} />
            {(card.pattern_ids?.length ?? 0) > 0 && <p className="text-muted-foreground">AI 匹配的研究模式：{card.pattern_ids?.map(id => researchPatterns.find(pattern => pattern.id === id)?.title ?? id).join('、')}（需核对）</p>}
            {card.sources.length ? card.sources.map(source => <SourceEvidence key={source.segment_uid} root={root} entryId={generation.entryId} source={source} onOpen={onOpenSource} />) : <p className="text-muted-foreground">未关联原文，请先核对。</p>}
          </div>)}
          <div className="flex flex-wrap gap-2"><Button size="sm" onClick={accept} disabled={!generation.cards.some(card => card.selected && card.title.trim() && card.body.trim())}>确认并保存所选卡片</Button><Button size="sm" variant="outline" onClick={addStructure} disabled={!context.activeBoard || !generation.cards.some(card => card.selected && card.title.trim() && card.body.trim())}>确认并加入方案</Button><Button size="sm" variant="outline" onClick={() => setGeneration(null)}>关闭</Button><Button size="sm" variant="ghost" onClick={() => onOpenEntry(generation.entryId)}>打开论文</Button></div>
        </section>}</DialogBody></DialogContent></Dialog>
        <Dialog open={manual} onOpenChange={setManual}><DialogContent layout="bounded"><DialogHeader><DialogTitle>新建卡片</DialogTitle><DialogDescription>描述研究问题、背景或解决方向。关闭窗口会保留本次输入。</DialogDescription></DialogHeader><DialogBody><section className="space-y-3">
          {manual && <><SearchInput label="搜索来源论文" placeholder="搜索来源论文或标签" value={paperQuery} onValueChange={setPaperQuery} />
            {!entry && <div className="max-h-32 overflow-y-auto text-xs">{entries.filter(item => paperQuery.trim() && `${item.title} ${item.tags.join(' ')}`.toLowerCase().includes(paperQuery.toLowerCase())).slice(0, 20).map(item => <Button key={item.id} variant="ghost" size="sm" className="w-full justify-start truncate" onClick={() => setEntryId(item.id)}>{item.title}</Button>)}<p className="text-muted-foreground">可选：搜索并关联论文；不选择则保存为我的卡片。</p></div>}
            {entry && <div className="flex items-center justify-between text-xs"><span className="truncate">{entry.title}</span><Button variant="ghost" size="sm" onClick={() => setEntryId('')}>更换</Button></div>}
            <Select value={kind} onValueChange={value => setKind(value as CardKind)}><SelectTrigger aria-label="卡片类型" size="sm" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(cardLabels).filter(([value]) => !context.branchTarget || context.branchTarget.kinds.includes(value as CardKind)).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
            <Button size="sm" variant="outline" disabled={Boolean(body.trim())} onClick={() => setBody(cardTemplateText(kind))}>填入{cardLabels[kind]}模板</Button>
            <p className="text-xs text-muted-foreground">每张卡只记录一个内容；模板未说明的字段可保留待补充。</p>
            <Input aria-label="卡片标题" placeholder="卡片标题" maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /><Textarea aria-label="卡片内容" placeholder="记录核对后的内容或自己的理解" maxLength={20000} value={body} onChange={e => setBody(e.target.value)} />
            <Button size="sm" disabled={!title.trim() || !body.trim() || Boolean(context.branchTarget && !context.branchTarget.kinds.includes(kind))} onClick={() => { const card = { id: crypto.randomUUID(), entry_id: entry?.id ?? userEntryId, title: title.trim(), body: body.trim(), kind }; const p = nextPosition(), target = targetFor(card.kind); placeCard(update, card, p.x, p.y, target); context.completeBranchTarget(target); setTitle(''); setBody(''); setManual(false); setSource(entry ? 'papers' : 'personal'); }}>{context.activeBoard ? '添加卡片并加入方案' : '保存到卡片库'}</Button></>}
        </section></DialogBody></DialogContent></Dialog>
        <section aria-label="卡片列表" className="space-y-2"><div className="text-xs text-muted-foreground">{rows.length} 张卡片 · 草稿需核对</div>
          {!rows.length && <p className="py-2 text-xs text-muted-foreground">没有匹配的卡片。可点击顶部加号创建，或调整来源与关键词。</p>}
          {rows.slice(0, limit).map(row => row.type === 'saved' ? <Card size="sm" key={row.card.id} {...dragProps(`card:${row.card.id}`, row.card)} className="gap-0 border bg-card py-2 shadow-none transition-colors hover:border-primary/40" data-testid={`library-card-${row.card.id}`}><CardContent className="min-w-0 space-y-1.5 px-3 text-xs">
            <div className="flex items-center justify-between gap-1"><span className="rounded border border-border/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"><CardTypeLabel kind={row.card.kind} />{row.card.origin === 'ai_draft' ? ' · AI 待核对' : ''}</span><Button size="sm" variant="outline" disabled={!context.activeBoard || alreadyAdded(row.card.id)} onClick={() => add(row.card.id)}>{row.card.origin === 'ai_draft' ? '前往核对' : alreadyAdded(row.card.id) ? '已添加' : addLabel}</Button></div>
            <button className="line-clamp-2 block w-full break-words text-left text-sm font-semibold leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring" onPointerDown={titleDrag(`card:${row.card.id}`, row.card)} onClick={() => { setSelectedCardId(row.card.id); setEntryId(row.card.entry_id); }}>{row.card.title}</button>
            <PaperCardBody card={row.card} /><p className="truncate border-t border-border/60 pt-2 text-[11px] text-muted-foreground">{row.card.entry_id === userEntryId ? '我的卡片' : row.card.entry_id === presetEntryId ? '研究模式' : entriesById.get(row.card.entry_id)?.title ?? '来源论文不可用'}</p>
          </CardContent></Card> : row.type === 'preset' ? <Card size="sm" key={row.card.id} {...dragProps(`preset:${row.card.id}`, row.card)} className="gap-0 border bg-card py-2 shadow-none transition-colors hover:border-primary/40" data-testid={`library-card-${row.card.id}`}><CardContent className="min-w-0 space-y-1.5 px-3 text-xs"><div className="flex items-center justify-between"><span className="text-muted-foreground">{row.card.id.startsWith('research-pattern-') ? 'ResearchStudio 研究模式' : '通用解决方向'}</span><Button size="sm" variant="outline" disabled={!context.activeBoard} onClick={() => { if(context.worksheetSection){const section=context.worksheetSection;update(current=>addWorksheetCard(current,row.card,section));}else{const p=nextPosition(),target=targetFor(row.card.kind);placeCard(update,row.card,p.x,p.y,target);context.completeBranchTarget(target);} }}>{addLabel}</Button></div><div className="line-clamp-2 break-words text-sm font-semibold leading-5">{row.card.title}</div><PaperCardBody card={row.card} />{researchPatterns.find(p => p.cardId === row.card.id) && <p className="text-muted-foreground">适用性需结合问题判断</p>}</CardContent></Card> : <Card size="sm" key={row.card.id} {...dragProps(`draft:${row.card.entryId}:${row.card.id}`, row.card)} className="gap-0 border bg-card py-2 shadow-none transition-colors hover:border-primary/40" data-testid={`library-card-${row.card.id}`}><CardContent className="min-w-0 space-y-1.5 px-3 text-xs"><div className="flex items-center justify-between"><span className="rounded border border-border/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"><CardTypeLabel kind={row.card.kind} /> · {('origin' in row.card && row.card.origin === 'ai_reviewed') ? '已确认' : '待核对'}</span><Button size="sm" variant="outline" disabled={!context.activeBoard || loading || alreadyAdded(row.card.id)} onClick={() => ('origin' in row.card && row.card.origin === 'ai_reviewed') ? void addDraft(row.card.entryId, row.card.id, row.card.kind) : openCardManager(row.card.entryId)}>{('origin' in row.card && row.card.origin === 'ai_reviewed') ? (alreadyAdded(row.card.id) ? '已添加' : addLabel) : '核对卡片'}</Button></div><button className="line-clamp-2 block w-full break-words text-left text-sm font-semibold leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring" onPointerDown={titleDrag(`draft:${row.card.entryId}:${row.card.id}`, row.card)} disabled={loading || Boolean(generation)} onClick={() => void openDraft(row.card.entryId)}>{row.card.title}</button>{row.card.body && <PaperCardBody card={row.card} />}<p className="truncate border-t border-border/60 pt-2 text-[11px] text-muted-foreground">{entriesById.get(row.card.entryId)?.title ?? '来源论文不可用'} · 点击标题核对</p><Button size="sm" variant="ghost" disabled={loading || Boolean(generation)} onClick={() => openCardManager(row.card.entryId)}>管理论文卡片</Button></CardContent></Card>)}
          {rows.length > limit && <Button variant="ghost" size="sm" onClick={() => setLimit(limit + 30)}>显示更多</Button>}
        </section>
        <p className="border-t pt-2 text-xs text-muted-foreground">卡片仅在你手动点击生成时整理。前往论文的卡片管理页生成、核对和确认。</p>
        {background.error && <p role="alert" className="text-xs text-destructive">{background.error}<Button size="sm" variant="ghost" onClick={() => void background.refresh()}>重新读取</Button></p>}
        <p className="text-xs text-muted-foreground">研究模式参考 ResearchStudio-Idea；用于启发，并非论文结论。<a className="underline" href={researchStudioUrl} target="_blank" rel="noreferrer">查看来源</a></p>
        <details className="text-xs text-muted-foreground"><summary>研究模式许可</summary><pre className="mt-1 whitespace-pre-wrap break-words">{researchStudioLicense}</pre></details>
      </>}
    </div>
    {drag.preview && <PointerPreview anchor={{ x: drag.preview.x, top: drag.preview.y, bottom: drag.preview.y }} width={240}><div className="p-2 text-xs"><p className="font-medium">{drag.preview.item.title}</p><p className="mt-1 text-muted-foreground">拖入画布或对应空位 · Esc 取消</p></div></PointerPreview>}
    {creatingBoard && <IdeationBoardDialog board="new" onClose={() => setCreatingBoard(false)} />}
  </aside>;
}
