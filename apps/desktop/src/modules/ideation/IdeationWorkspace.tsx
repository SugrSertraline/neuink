import { ResearchPlanDialog } from './ResearchPlanDialog';
import { useMemo, useState } from 'react';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { SourceLinkOpenTarget } from '@/modules/notes/editor/SourceLinkNode';
import type { IdeationLink, Placement } from '@/shared/ipc/ideationApi';
import { useIdeationContext } from './IdeationContext';
import { clamp, placeCard, placeDraftCard, presetCards, presetEntryId, userEntryId } from './ideationUtils';
import { nodeCard } from './ideationBoards';
import { IdeationBoardDialog } from './IdeationBoardList';
import { IdeationCanvas, type CanvasNode } from './IdeationCanvas';
import { IdeationInspector } from './IdeationInspector';
import type { BranchSlot } from './ideationBranches';

type Props = {
  root: string; entries: LibraryEntry[];
  onOpenEntry: (id: string) => void;
  onOpenSource?: (target: SourceLinkOpenTarget) => void;
};
export function IdeationWorkspace(props: Props) {
  const context = useIdeationContext();
  const [creating, setCreating] = useState(false);
  if (!context) return <p className="p-4 text-sm text-muted-foreground">请先打开资料库。</p>;
  if (!context.state) return <div className="p-4 text-sm" role={context.error ? 'alert' : 'status'}>{context.error ? `研究构思读取失败：${context.error}` : '正在读取研究构思…'}{context.error && <Button size="sm" variant="outline" onClick={context.retryLoad}>重新读取</Button>}</div>;
  if (!context.activeBoard) return <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6"><h1 className="text-lg font-semibold">研究构思</h1><p className="max-w-md text-center text-sm leading-relaxed text-muted-foreground">为每个研究问题建立一张画布。从论文中复用卡片，连接问题、方法与证据，逐步形成可讨论的方向。</p><p role={context.error ? 'alert' : 'status'} className={context.error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{context.error ? `保存失败：${context.error}。当前修改仍保留。` : context.saving ? '保存中…' : context.dirty ? '未保存' : '已保存到本地'}</p>{context.dirty && <Button size="sm" variant="outline" disabled={context.saving} onClick={() => void context.save()}>保存</Button>}<div className="flex gap-2"><Button onClick={() => setCreating(true)}>新建构思</Button><Button variant="outline" onClick={() => { context.setSidebarTab('boards'); context.showSidebar(); }}>查看构思列表</Button></div>{creating && <IdeationBoardDialog board="new" onClose={() => setCreating(false)} />}</div>;
  return <ActiveWorkspace key={context.activeBoard.id} {...props} />;
}

function ActiveWorkspace({ root, entries, onOpenEntry, onOpenSource }: Props) {
  const context = useIdeationContext()!;
  const { state: currentState, activeBoard: currentBoard, update, save, dirty, saving, error, selectedCardId, setSelectedCardId, selectSlot } = context;
  const state = currentState!, board = currentBoard!;
  const entriesById = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [choosingBranch, setChoosingBranch] = useState(false);
  const [undo, setUndo] = useState<{ nodes: Placement[]; links: IdeationLink[] } | null>(null);
  const cards = new Map(state.cards.map(card => [card.id, card]));
  const nodes: CanvasNode[] = state.placements.flatMap(p => {
    const source = cards.get(p.card_id); if (!source) return [];
    return [{ ...p, card: nodeCard(p, source), sourceTitle: source.entry_id === userEntryId ? '我的卡片' : source.entry_id === presetEntryId ? '通用研究模式' : entriesById.get(source.entry_id)?.title ?? '来源论文不可用' }];
  });
  const links = state.links ?? [];
  const byId = new Map(nodes.map(p => [p.id, p]));
  const selectedNode = context.selectionSource === 'canvas' ? nodes.find(node => node.id === selectedNodeId && node.card_id === selectedCardId) : undefined;
  const selectedLink = selectedCardId ? undefined : links.find(link => link.id === selectedLinkId);
  const previewCard = selectedNode ? selectedNode.card : cards.get(selectedCardId ?? '');
  const slots = !connecting && context.branchTarget ? [context.branchTarget] : [];
  const clearSelection = () => { setSelectedNodeId(null); setSelectedLinkId(null); setSelectedCardId(null); context.selectBranchSource(null); };
  const selectLink = (id: string) => { setSelectedLinkId(id); setSelectedNodeId(null); setSelectedCardId(null); setConnecting(null); context.selectBranchSource(null); };
  const connect = (from: string, to: string) => {
    if (from === to) { setConnecting(null); return; }
    const existing = links.find(link => link.from === from && link.to === to);
    if (existing) { selectLink(existing.id); return; }
    const id = crypto.randomUUID(), a = byId.get(from), b = byId.get(to);
    const kind = a?.card.kind === 'background' && b?.card.kind === 'problem' ? 'motivates' : b?.card.kind === 'problem' && ['method', 'component', 'idea'].includes(a?.card.kind ?? '') ? 'addresses' : 'related';
    update(current => ({ ...current, links: [...(current.links ?? []), { id, from, to, kind, origin: 'user' }] }));
    selectLink(id);
  };
  const selectNode = (id: string, toggle = true) => {
    if (connecting) { connect(connecting, id); return; }
    const node = byId.get(id); if (!node) return;
    if (toggle && context.branchSourceId === id && selectedNodeId === id) { clearSelection(); setInspecting(false); return; }
    setChoosingBranch(true); setSelectedNodeId(id); setSelectedLinkId(null); context.selectCanvasCard(node.card_id); context.selectBranchSource(id); setInspecting(false);
  };
  const removeNode = (id: string) => {
    const node = state.placements.find(p => p.id === id); if (!node) return;
    setUndo({ nodes: [node], links: links.filter(link => link.from === id || link.to === id) });
    update(current => ({ ...current, placements: current.placements.filter(p => p.id !== id), links: (current.links ?? []).filter(link => link.from !== id && link.to !== id) }));
    clearSelection(); setConnecting(null);
  };
  const removeLink = (id: string) => { setUndo({ nodes: [], links: links.filter(link => link.id === id) }); update(current => ({ ...current, links: current.links?.filter(link => link.id !== id) })); clearSelection(); };
  const branch = (id: string) => {
    const node = byId.get(id); if (!node) return;
    const newId = crypto.randomUUID();
    update(current => ({ ...current, placements: [...current.placements, { id: newId, card_id: node.card_id, x: clamp(node.x + 340, 10000), y: clamp(node.y + 260, 10000), title: `${node.card.title.slice(0, 145)}（分支）`, body: node.card.body }], links: [...(current.links ?? []), { id: crypto.randomUUID(), from: id, to: newId, kind: 'alternative', origin: 'user' }] }));
    setSelectedNodeId(newId); context.selectCanvasCard(node.card_id); context.selectBranchSource(newId); setInspecting(true);
  };
  const drop = (data: string, x: number, y: number, slot?: BranchSlot) => {
    setCanvasError(null);
    try {
      if (data.startsWith('card:')) { const card = cards.get(data.slice(5)); if (card) placeCard(update, card, x, y, slot); }
      else if (data.startsWith('preset:')) { const card = presetCards.find(item => item.id === data.slice(7)); if (card) placeCard(update, card, x, y, slot); }
      else if (data.startsWith('draft:')) { const [entryId, cardId] = data.slice(6).split(':'); if (entryId && cardId) void placeDraftCard(root, update, entryId, cardId, x, y, slot).then(() => context.completeBranchTarget(slot)).catch(() => setCanvasError('无法填入卡片：请检查类型或刷新草稿后重试。')); }
      if (!data.startsWith('draft:')) context.completeBranchTarget(slot);
    } catch { setCanvasError('这张卡片不适合此空位，请选择对应类型的卡片。'); }
  };
  return <div className="@container flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="研究构思">
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
      <Button size="sm" variant="ghost" onClick={() => { context.setSidebarTab('boards'); context.showSidebar(); }}><ArrowLeft />构思列表</Button>
      <div className="min-w-[120px] flex-1"><div className="flex items-center gap-1"><h1 className="truncate text-sm font-semibold" title={board.title}>{board.title}</h1><Button size="icon-sm" variant="ghost" aria-label="编辑构思名称与说明" onClick={() => setEditing(true)}><Pencil className="size-3" /></Button></div>{board.description && <p className="truncate text-xs text-muted-foreground" title={board.description}>{board.description}</p>}</div>
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground" role="status">{saving ? '保存中…' : dirty ? '未保存' : '已保存到本地'}</span><Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => void save()}>保存</Button></div>
    </header>
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-1.5"><Button size="sm" variant="outline" onClick={() => selectSlot(null)}>浏览卡片</Button><Button size="sm" variant="ghost" onClick={() => { selectSlot('problem'); context.requestCard('problem'); }}><Plus />研究问题</Button><Button size="sm" variant="outline" disabled={!nodes.length} onClick={() => setPlanning(true)}>评价并生成方案</Button><span className="ml-auto text-xs text-muted-foreground">{nodes.length} 张卡片 · {links.length} 条关系</span></div>
    {(error || canvasError) && <div role="alert" className="shrink-0 border-b px-3 py-2 text-xs text-destructive">{error ? `保存失败：${error}。修改仍在当前页面，请重试保存。` : canvasError}</div>}
    {undo && <div role="status" className="flex shrink-0 items-center gap-2 border-b px-3 py-1 text-xs">已移除{undo.nodes.length ? '卡片及相关连线' : '关系'}<Button size="sm" variant="ghost" onClick={() => {
      update(current => { const ids = new Set([...current.placements.map(p => p.id), ...undo.nodes.map(p => p.id)]); return { ...current, placements: [...current.placements, ...undo.nodes], links: [...(current.links ?? []), ...undo.links.filter(link => ids.has(link.from) && ids.has(link.to))] }; }); setUndo(null);
    }}>撤销移除</Button><Button size="sm" variant="ghost" onClick={() => setUndo(null)}>关闭提示</Button></div>}
    <div className="relative flex min-h-0 flex-1">
      <IdeationCanvas onCanvasWidth={context.setCanvasWidth} workspaceRoot={root} boardId={board.id} branchSourceId={context.branchSourceId} showBranchPopover={choosingBranch && !inspecting && !connecting} onRequestBranch={id => { context.requestBranch(id); setChoosingBranch(false); }} onOpenBranches={id => selectNode(id, false)} routes={context.layoutRoutes} layoutVersion={context.layoutVersion} onArrange={context.arrange} nodes={nodes} links={links} slots={slots} activeSlot={context.branchTarget} onSelectSlot={context.selectBranchTarget} onCreateProblem={() => { selectSlot('problem'); context.requestCard('problem'); }} viewport={board.viewport} selectedNodeId={selectedNodeId} selectedLinkId={selectedLinkId} connecting={connecting}
        onSelectNode={selectNode} onRemoveNode={removeNode} onEditNode={id => { selectNode(id, false); setInspecting(true); }} onSelectLink={selectLink} onConnect={id => { if (connecting) connect(connecting, id); else { setConnecting(id); clearSelection(); } }} onCancelConnect={() => setConnecting(null)}
        onMove={(id, x, y) => update(current => ({ ...current, placements: current.placements.map(p => p.id === id && !p.locked ? { ...p, x, y, slot: undefined } : p) }))}
        onViewport={viewport => context.editBoard(board.id, { viewport })} onDropCard={drop} onBrowse={selectSlot} onClearSelection={clearSelection} />
      {(selectedLink || (previewCard && (inspecting || context.selectionSource === 'library'))) && <IdeationInspector key={selectedLink?.id ?? selectedNode?.id ?? previewCard?.id} root={root} node={selectedNode} card={previewCard} link={selectedLink} nodes={nodes} onClose={() => { setInspecting(false); if (!selectedNode) { setSelectedLinkId(null); setSelectedCardId(null); } }} onRemoveNode={removeNode} onRemoveLink={removeLink} onBranch={branch} onOpenEntry={onOpenEntry} onOpenSource={onOpenSource} />}
    </div>
    {planning && <ResearchPlanDialog root={root} onClose={() => setPlanning(false)} />}
    {editing && <IdeationBoardDialog board={board} onClose={() => setEditing(false)} />}
  </div>;
}
