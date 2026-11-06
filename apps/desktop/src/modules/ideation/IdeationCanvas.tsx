import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type PointerEvent } from 'react';
import { GitFork, GripVertical, Link2, LockKeyhole, Minus, Pencil, Plus, Scan } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { IdeationLink, IdeationViewport, PaperCard, Placement } from '@/shared/ipc/ideationApi';
import { cardLabels, clamp, ideationDragType } from './ideationUtils';
import { relationLabel } from './ideationBoards';
import type { BranchSlot } from './ideationBranches';
import { nodeWidth, nodeHeight, slotHeight, slotKey, type LayoutRoute } from './ideationLayout';
import { routeBetween } from './ideationRouting';
import { ideationCardDrag } from './ideationDrag';
import { IdeationBranchPopover } from './IdeationBranchPopover';

export type CanvasNode = Placement & { card: PaperCard; sourceTitle: string };
const width = nodeWidth, height = nodeHeight;
const initialView = { x: 0, y: 0, scale: 1 };

type Gesture = { pointer: number; startX: number; startY: number; nodeId?: string; x: number; y: number; uiScale: number; originalView: IdeationViewport };

/** Canvas owns pan, zoom and movement; only completed gestures are persisted. No scrolling surface. */
export function IdeationCanvas({ nodes, links, slots = [], activeSlot, viewport, selectedNodeId, selectedLinkId, connecting, onSelectNode, onEditNode, onSelectLink, onConnect, onCancelConnect, onMove, onViewport, onDropCard, onBrowse, onClearSelection, onSelectSlot, onCreateProblem, routes, layoutVersion, onArrange, workspaceRoot, boardId, branchSourceId, showBranchPopover, onRequestBranch, onOpenBranches, onCanvasWidth }: {
  onCanvasWidth: (width: number) => void;
  onOpenBranches: (id: string) => void;
  workspaceRoot: string; boardId: string; branchSourceId: string | null; showBranchPopover: boolean; onRequestBranch: (id: string) => void;
  routes: Record<string, LayoutRoute>; layoutVersion: number; onArrange: () => void;
  nodes: CanvasNode[]; links: IdeationLink[]; viewport?: IdeationViewport | null;
  selectedNodeId: string | null; selectedLinkId: string | null; connecting: string | null;
  onSelectNode: (id: string) => void; onSelectLink: (id: string) => void; onConnect: (id: string) => void;
  onEditNode: (id: string) => void;
  onCancelConnect: () => void; onMove: (id: string, x: number, y: number) => void;
  onViewport: (view: IdeationViewport) => void; onDropCard: (data: string, x: number, y: number, slot?: BranchSlot) => void;
  onBrowse: (kind: 'problem' | 'idea' | null) => void; onClearSelection: () => void;
  slots?: BranchSlot[]; activeSlot?: BranchSlot | null; onSelectSlot: (slot: BranchSlot) => void; onCreateProblem: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const dragged = useSyncExternalStore(ideationCardDrag.subscribe, ideationCardDrag.getState);
  const dropLatest = useRef({ slots, onDropCard }); dropLatest.current = { slots, onDropCard };
  useEffect(() => {
    const element = root.current; if (!element) return;
    return ideationCardDrag.register({ element, accepts: item => item.workspaceRoot === workspaceRoot && item.boardId === boardId,
      onDrop: item => {
        const hit = document.elementFromPoint?.(item.x, item.y)?.closest('[data-branch-slot]');
        const slot = hit && element.contains(hit) ? dropLatest.current.slots.find(slot => slot.id === hit.getAttribute('data-branch-slot')) : undefined;
        if (slot) dropLatest.current.onDropCard(item.data, slot.x, slot.y, slot);
        else {
          const rect = element.getBoundingClientRect(), scale = element.clientWidth ? rect.width / element.clientWidth : 1, view = viewRef.current;
          dropLatest.current.onDropCard(item.data, clamp(((item.x - rect.left) / scale - view.x) / view.scale - width / 2, 10000), clamp(((item.y - rect.top) / scale - view.y) / view.scale - 24, 10000));
        }
      } });
  }, [workspaceRoot, boardId]);
  const [view, setView] = useState(viewport ?? initialView);
  const viewRef = useRef(view); viewRef.current = view;
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
  const movingRef = useRef(moving); movingRef.current = moving;
  const gesture = useRef<Gesture | null>(null);
  const fitting = useRef(false);
  const fitMinimum = useRef(.9);
  const lastFocus = useRef<{ source: string | null; slot?: string; x?: number; y?: number; layout: number; choosing: boolean } | null>(null);
  const fitBranch = useRef(false);
  const fitLatest = useRef(() => {});
  const marker = useId().replace(/:/g, '');
  const shown = nodes.map(node => moving?.id === node.id ? { ...node, x: moving.x, y: moving.y } : node);
  const byId = new Map(shown.map(node => [node.id, node]));
  const geometry = useMemo(() => {
    const rectangles = [...shown, ...slots.map(slot => ({ ...slot, height: slotHeight }))];
    const result = new Map<string, ReturnType<typeof routeBetween>>();
    for (const link of links) {
      const from = byId.get(link.from), to = byId.get(link.to);
      if (from && to) result.set(link.id, routeBetween(from, to, rectangles, routes[link.id]));
    }
    for (const slot of slots) {
      const from = byId.get(slot.sourceId);
      if (from) result.set(slotKey(slot), routeBetween(from, { ...slot, height: slotHeight }, rectangles, undefined, -32));
    }
    return result;
  }, [nodes, links, slots, moving, routes]);
  const cancel = () => {
    const current = gesture.current;
    if (current) { setView(current.originalView); gesture.current = null; setMoving(null); }
  };
  useEffect(() => {
    const blur = () => cancel();
    window.addEventListener('blur', blur);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { cancel(); if (root.current?.clientWidth) onCanvasWidth(root.current.clientWidth); if (fitting.current) fitLatest.current(); });
    if (root.current) observer?.observe(root.current);
    return () => { window.removeEventListener('blur', blur); observer?.disconnect(); };
  }, []);
  const commitView = (next: IdeationViewport) => { setView(next); onViewport(next); };
  const zoom = (nextScale: number) => {
    const element = root.current; if (!element) return;
    fitting.current = false;
    const scale = Math.max(.2, Math.min(2, nextScale)), ratio = scale / view.scale;
    commitView({ scale, x: element.clientWidth / 2 - (element.clientWidth / 2 - view.x) * ratio, y: element.clientHeight / 2 - (element.clientHeight / 2 - view.y) * ratio });
  };
  const branchAnchor = nodes.find(node => node.id === branchSourceId);
  const fit = (minimum = .2, branchOnly = false) => {
    const element = root.current; if (!element || !nodes.length) { commitView(initialView); return; }
    fitting.current = true;
    fitMinimum.current = minimum;
    fitBranch.current = branchOnly;
    const focus = branchOnly && branchSourceId ? nodes.filter(node => node.id === branchSourceId) : nodes;
    const bounds = [...focus.map(n => ({ ...n, height })), ...slots.map(slot => ({ ...slot, height: slotHeight }))];
    if (branchOnly && branchAnchor && showBranchPopover) bounds.push({ ...branchAnchor, y: branchAnchor.y + height + 12, height: 104 });
    if (branchOnly && branchAnchor) {
      const adjacent = new Set(links.flatMap(link => link.from === branchSourceId ? [link.to] : link.to === branchSourceId ? [link.from] : []));
      const nearby = nodes.filter(node => adjacent.has(node.id)).sort((a, b) => Math.hypot(a.x - branchAnchor.x, a.y - branchAnchor.y) - Math.hypot(b.x - branchAnchor.x, b.y - branchAnchor.y));
      for (const neighbor of nearby) {
        const trial = [...bounds, { ...neighbor, height }];
        const w = Math.max(...trial.map(n => n.x)) + width - Math.min(...trial.map(n => n.x));
        const h = Math.max(...trial.map(n => n.y + n.height)) - Math.min(...trial.map(n => n.y));
        if (w * minimum <= element.clientWidth - 48 && h * minimum <= element.clientHeight - 96) bounds.push({ ...neighbor, height });
      }
    }
    const left = Math.min(...bounds.map(n => n.x)), top = Math.min(...bounds.map(n => n.y));
    const w = Math.max(...bounds.map(n => n.x)) + width - left, h = Math.max(...bounds.map(n => n.y + n.height)) - top;
    const scale = Math.max(minimum, Math.min(1, (element.clientWidth - 48) / w, (element.clientHeight - 96) / h));
    commitView({ x: Math.max(24, (element.clientWidth - w * scale) / 2) - left * scale, y: Math.max(24, (element.clientHeight - h * scale) / 2) - top * scale, scale });
  };
  fitLatest.current = () => fit(fitMinimum.current, fitBranch.current);
  useLayoutEffect(() => {
    const previous = lastFocus.current;
    const newBranch = branchSourceId && (previous?.source !== branchSourceId || (activeSlot && (previous?.slot !== activeSlot.id || previous?.x !== activeSlot.x || previous?.y !== activeSlot.y)));
    if (!previous || previous.layout !== layoutVersion || newBranch || (showBranchPopover && !previous.choosing)) {
      fitMinimum.current = .9; fitBranch.current = Boolean(branchSourceId); fitLatest.current();
    }
    // Finishing a slot or dismissing the bubble must not move the filled card on screen.
    lastFocus.current = { source: branchSourceId, slot: activeSlot?.id, x: activeSlot?.x, y: activeSlot?.y, layout: layoutVersion, choosing: showBranchPopover };
  }, [layoutVersion, branchSourceId, activeSlot?.id, activeSlot?.x, activeSlot?.y, showBranchPopover]);
  const uiScale = () => { const element = root.current; return element?.clientWidth ? element.getBoundingClientRect().width / element.clientWidth : 1; };
  const startMove = (event: PointerEvent<HTMLElement>, node: CanvasNode) => {
    if (event.button !== 0 || node.locked || gesture.current) return;
    event.stopPropagation(); fitting.current = false;
    gesture.current = { pointer: event.pointerId, nodeId: node.id, startX: event.clientX, startY: event.clientY, x: node.x, y: node.y, uiScale: uiScale(), originalView: view };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    const data = event.dataTransfer.getData(ideationDragType); if (!data) return;
    event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect();
    onDropCard(data, clamp(((event.clientX - rect.left) / uiScale() - view.x) / view.scale - width / 2, 10000), clamp(((event.clientY - rect.top) / uiScale() - view.y) / view.scale - 24, 10000));
  };
  return <section ref={root} aria-label="构思画布" tabIndex={0} className="ideation-canvas relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/20 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
    style={{ backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)', backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`, backgroundPosition: `${view.x}px ${view.y}px`, touchAction: 'none' }}
    onDragOver={event => { if (Array.from(event.dataTransfer.types).includes(ideationDragType)) event.preventDefault(); }} onDrop={drop}
    onKeyDown={event => { if (event.key === 'Escape') { cancel(); onCancelConnect(); onClearSelection(); } }}
    onPointerDown={event => {
      if (event.target !== event.currentTarget || event.button !== 0 || gesture.current) return;
      fitting.current = false;
      gesture.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, x: view.x, y: view.y, uiScale: uiScale(), originalView: view };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }}
    onPointerMove={event => {
      const g = gesture.current; if (!g || g.pointer !== event.pointerId) return;
      const dx = (event.clientX - g.startX) / g.uiScale, dy = (event.clientY - g.startY) / g.uiScale;
      if (g.nodeId) setMoving({ id: g.nodeId, x: clamp(g.x + dx / view.scale, 10000), y: clamp(g.y + dy / view.scale, 10000) });
      else setView({ ...view, x: Math.max(-100000, Math.min(100000, g.x + dx)), y: Math.max(-100000, Math.min(100000, g.y + dy)) });
    }} onPointerUp={event => {
      const g = gesture.current; if (!g || g.pointer !== event.pointerId) return;
      gesture.current = null;
      if (g.nodeId && movingRef.current) onMove(g.nodeId, movingRef.current.x, movingRef.current.y);
      else if (!g.nodeId) onViewport(viewRef.current);
      setMoving(null);
    }} onPointerCancel={cancel} onLostPointerCapture={cancel}>
    <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
      <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-label="卡片连线"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" /></marker></defs>
        {slots.map(slot => { const from = byId.get(slot.sourceId); return from ? <path key={`suggestion-${slot.id}`} d={geometry.get(slotKey(slot))?.path} stroke={activeSlot?.id === slot.id ? 'var(--primary)' : 'var(--muted-foreground)'} strokeWidth="1.4" strokeDasharray="5 5" opacity=".6" fill="none" /> : null; })}
        {links.map(link => {
          const from = byId.get(link.from), to = byId.get(link.to); if (!from || !to) return null;
          const g = geometry.get(link.id)! , label = relationLabel(link), selected = selectedLinkId === link.id;
          return <g key={link.id} data-testid={`relation-${link.id}`} role="button" tabIndex={0} aria-label={`编辑关系：${from.card.title} → ${label} → ${to.card.title}`}
            className="pointer-events-auto cursor-pointer outline-none focus:text-primary" style={{ color: selected ? 'var(--primary)' : 'var(--muted-foreground)' }}
            onClick={() => onSelectLink(link.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectLink(link.id); } }}>
            <path d={g.path} stroke="transparent" strokeWidth="20" fill="none" />
            <path d={g.path} stroke="currentColor" strokeWidth={selected ? 2.5 : 1.6} strokeDasharray={link.origin === 'ai_inferred' ? '5 4' : undefined} fill="none" markerEnd={`url(#${marker})`} />
            <rect x={g.x - Math.min(110, label.length * 6.5 + 10)} y={g.y - 13} width={Math.min(220, label.length * 13 + 20)} height={26} rx="5" fill="var(--background)" stroke={selected ? 'var(--primary)' : 'var(--border)'} />
            <text x={g.x} y={g.y + 4} textAnchor="middle" fill="currentColor" fontSize="12">{label.length > 15 ? `${label.slice(0, 14)}…` : label}</text>
          </g>;
        })}
      </svg>
      {slots.map(slot => <Button key={`${slot.sourceId}-${slot.id}`} variant="outline" aria-label={`下一步：${slot.title}`} aria-pressed={activeSlot?.id === slot.id} data-branch-slot={slot.id}
        className={`ideation-branch-slot pointer-events-auto absolute h-auto flex-col items-stretch justify-start gap-0 overflow-hidden whitespace-normal border-dashed p-0 text-left ${activeSlot?.id === slot.id || (dragged && dragged.workspaceRoot === workspaceRoot && dragged.boardId === boardId && slot.kinds.includes(dragged.kind)) ? 'border-primary bg-accent text-accent-foreground ring-1 ring-primary/20' : 'bg-background'}`}
        style={{ left: slot.x, top: slot.y, width, height: slotHeight }} onClick={() => onSelectSlot(slot)}
        onDragOver={event => { if (Array.from(event.dataTransfer.types).includes(ideationDragType)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={event => { const data = event.dataTransfer.getData(ideationDragType); if (data) { event.preventDefault(); event.stopPropagation(); onDropCard(data, slot.x, slot.y, slot); } }}>
        <span className="min-h-9 border-b border-dashed px-3 py-2 text-xs font-normal text-muted-foreground">待补充 · {slot.kinds.map(kind => cardLabels[kind]).join(' / ')}</span>
        <span className="flex flex-1 flex-col justify-center gap-2 px-3 py-3"><span className="flex items-center gap-2 text-sm font-medium"><Plus className="size-4 shrink-0" />{slot.title}</span><span className="text-xs font-normal leading-relaxed text-muted-foreground">{slot.description}</span></span>
        <span className="border-t border-dashed px-3 py-2 text-[11px] font-normal text-muted-foreground">从左侧拖入卡片，或点击选择</span>
      </Button>)}
      {shown.map(node => <IdeationBranchPopover key={node.id} kind={node.card.kind} open={showBranchPopover && branchSourceId === node.id && !moving && !dragged} activeRule={activeSlot?.id} container={root.current} onChoose={onRequestBranch} onClose={onClearSelection}><article data-node-id={node.id} className="pointer-events-auto absolute" style={{ left: node.x, top: node.y, width, height }}>
        <Card size="sm" className={`h-full gap-0 py-0 shadow-sm ${selectedNodeId === node.id || connecting === node.id ? 'border-primary ring-1 ring-primary/30' : ''}`}>
          <div onPointerDown={event => startMove(event, node)} className={`flex min-h-9 touch-none items-center gap-1 border-b bg-muted/30 px-2 text-xs text-muted-foreground ${node.locked ? '' : 'cursor-grab active:cursor-grabbing'}`}>
            <Button variant="ghost" size="icon-sm" aria-label={`使用方向键移动 ${node.card.title}`} disabled={node.locked} className="cursor-grab touch-none active:cursor-grabbing"
              onPointerDown={event => startMove(event, node)} onKeyDown={event => {
                const delta = event.shiftKey ? 50 : 20;
                const d = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] }[event.key];
                if (d) { event.preventDefault(); event.stopPropagation(); onMove(node.id, clamp(node.x + d[0], 10000), clamp(node.y + d[1], 10000)); }
              }}><GripVertical className="size-3.5" /></Button>
            <span className="flex-1 truncate">{cardLabels[node.card.kind]}</span>{node.locked && <LockKeyhole className="size-3" aria-label="已固定" />}
            {node.card.origin === 'ai_draft' && <span className="text-[10px]">待核对</span>}
            <Button size="icon-sm" variant="ghost" aria-label={`编辑卡片 ${node.card.title}`} title="编辑卡片" onPointerDown={event => event.stopPropagation()} onClick={() => onEditNode(node.id)}><Pencil className="size-3" /></Button>
          </div>
          <button className="min-h-0 flex-1 space-y-2 overflow-hidden px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => onSelectNode(node.id)} aria-label={node.card.title} aria-pressed={selectedNodeId === node.id}>
            <span className="line-clamp-2 text-sm font-medium leading-snug">{node.card.title}</span><span className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{node.card.body || '点击补充内容'}</span>
          </button>
          <div className="flex items-center gap-1 border-t px-3 py-1"><span title={node.sourceTitle} className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{node.sourceTitle}</span><Button size="sm" variant="ghost" aria-label={`选择分支 ${node.card.title}`} onClick={() => onOpenBranches(node.id)}><GitFork className="size-3" />下一步</Button><Button size="sm" variant={connecting === node.id ? 'secondary' : 'ghost'} onClick={() => onConnect(node.id)}><Link2 className="size-3" />连接</Button></div>
        </Card>
      </article></IdeationBranchPopover>)}
    </div>
    {!nodes.length && <div className="absolute left-1/2 top-1/2 w-[min(30rem,calc(100%-3rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-dashed bg-background/90 p-6 text-center">
      <h2 className="text-sm font-medium">从一个问题开始，尝试不同的解决路径</h2><p className="mt-2 text-xs leading-relaxed text-muted-foreground">把左侧论文卡片拖到任意位置。卡片之间可连接、拆分、递进或提出反例，无需按固定步骤填满。</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2"><Button size="sm" onClick={onCreateProblem}><Plus />创建研究问题</Button><Button size="sm" variant="outline" onClick={() => onBrowse('problem')}>从已有问题开始</Button></div>
    </div>}
    {connecting && <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs text-muted-foreground"><span>选择另一张卡片建立有向关系</span><Button size="sm" variant="ghost" onClick={onCancelConnect}>取消连接</Button></div>}
    <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2 pointer-events-none">
      <span className="hidden rounded border bg-background px-2 py-1 text-[11px] text-muted-foreground @[700px]:block">空白处拖动平移 · 再点卡片取消选中</span>
      <div className="pointer-events-auto ml-auto flex items-center rounded-md border bg-background p-1"><Button size="icon-sm" variant="ghost" aria-label="缩小画布" onClick={() => zoom(view.scale - .1)}><Minus /></Button><Button size="sm" variant="ghost" aria-label="恢复百分之百缩放" onClick={() => zoom(1)}>{Math.round(view.scale * 100)}%</Button><Button size="icon-sm" variant="ghost" aria-label="放大画布" onClick={() => zoom(view.scale + .1)}><Plus /></Button><Button size="sm" variant="ghost" onClick={onArrange}><GitFork />自动排列</Button><Button size="sm" variant="ghost" onClick={() => fit()}><Scan />适应画布</Button></div>
    </div>
  </section>;
}
