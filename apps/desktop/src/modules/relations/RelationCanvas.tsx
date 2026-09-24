import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Info, List, Maximize, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PointerPreview } from '@/components/ui/pointer-preview';
import { useReaderPreviewVisible } from '@/components/ui/hover-interactions';
import { RelationIcon, relationNodeLabel } from './RelationIcon';
import { visibleLabels, type NodeProjection } from './relationSceneData';
import { useRelationScene } from './useRelationScene';
import { useRelationHover } from './useRelationHover';
import type { RelationGraph } from './relationGraph';

export function RelationCanvas({ graph, selectedId, active = true, onSelect, renderDetails }: {
  graph: RelationGraph; selectedId: string | null; active?: boolean;
  onSelect: (id: string | null) => void; renderDetails?: (onClose: () => void) => ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), anchor = useRef<HTMLSpanElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>()), positions = useRef(new Map<string, NodeProjection>());
  const { hoveredId, setCanvas, setLabel, setFocus, clear: clearHover } = useRelationHover();
  const [picker, setPicker] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(true);
  const selectNode = useCallback((id: string | null) => { if (id) setDetailsVisible(true); onSelect(id); }, [onSelect]);
  const mode = useRef('spatial');
  const hovered = graph.nodes.find(node => node.id === hoveredId);
  const previewVisible = useReaderPreviewVisible(hoveredId ?? '');
  const selection = useRef(selectedId); selection.current = selectedId;
  const hover = useRef(hoveredId); hover.current = hoveredId;
  const project = useCallback((points: NodeProjection[]) => {
    positions.current = new Map(points.map(point => [point.id, point]));
    const occupied: { x: number; y: number; width: number }[] = [];
    const ranked = [...buttons.current].sort(([a, elA], [b, elB]) =>
      Number(b === selection.current || b === hover.current) - Number(a === selection.current || a === hover.current)
      || Number(elB.dataset.kind === 'tag') - Number(elA.dataset.kind === 'tag'));
    for (const [id, button] of ranked) {
      const point = positions.current.get(id);
      const width = button.offsetWidth || 140;
      const collides = point && occupied.some(box => Math.abs(box.y - point.y) < 24 && point.x + 13 < box.x + box.width && point.x + 13 + width > box.x);
      const shown = point?.visible && (!collides || id === selection.current || id === hover.current);
      button.style.visibility = shown ? 'visible' : 'hidden';
      if (shown && point) occupied.push({ x: point.x + 13, y: point.y, width });
      if (point) { button.style.left = point.x + 'px'; button.style.top = point.y + 'px'; button.style.opacity = String(point.depth); }
    }
    const point = positions.current.get(selection.current ?? '');
    if (anchor.current && viewport.current) {
      const wide = viewport.current.clientWidth >= 880;
      const planar = mode.current === 'planar';
      anchor.current.style.left = (planar ? Math.max(24, viewport.current.clientWidth - 380) : Math.max(24, Math.min(viewport.current.clientWidth - 24, point?.x ?? viewport.current.clientWidth / 2))) + 'px';
      anchor.current.style.top = (planar ? wide ? 62 : Math.max(72, viewport.current.clientHeight - 196) : Math.max(24, Math.min(viewport.current.clientHeight - 24, point?.y ?? viewport.current.clientHeight / 2))) + 'px';
    }
  }, []);
  const { scene, status, view, retry } = useRelationScene({ host, viewport, graph, active, selectedId, hoveredId, onProject: project, onHover: setCanvas, onSelect: selectNode });
  const transitioning = view.mode === 'entering' || view.mode === 'leaving';
  const planar = view.mode === 'planar';
  const labelIds = useMemo(() => planar && view.ids ? new Set(view.ids)
    : new Set([...visibleLabels(graph, selectedId, hoveredId), ...(view.ids ?? [])]), [graph, selectedId, hoveredId, planar, view.ids]);
  mode.current = view.mode;
  useEffect(() => { project([...positions.current.values()]); }, [selectedId, labelIds, project, status, view.mode]);
  useEffect(() => { setDetailsVisible(true); }, [selectedId]);
  useEffect(() => {
    const element = viewport.current;
    const wheel = (event: WheelEvent) => {
      if (!(event.target as Element).closest('.relation-labels')) return;
      event.preventDefault(); clearHover();
      scene.current?.zoom(Math.exp(Math.max(-.3, Math.min(.3, event.deltaY * (event.deltaMode === 1 ? .025 : .0015)))));
    };
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => element?.removeEventListener('wheel', wheel);
  }, [scene, clearHover]);
  useEffect(() => { clearHover(); }, [graph, selectedId, clearHover]);
  useEffect(() => { if (!active) { clearHover(); setPicker(false); } }, [active, clearHover]);
  const point = positions.current.get(hoveredId ?? ''), rect = viewport.current?.getBoundingClientRect();
  const scale = rect && viewport.current?.offsetWidth ? rect.width / viewport.current.offsetWidth : 1;
  const hoverAnchor = point && rect ? { x: rect.left + point.x * scale, top: rect.top + point.y * scale, bottom: rect.top + point.y * scale + 12 } : null;
  return <div className="relation-stage relative min-h-0 min-w-0 flex-1 overflow-hidden" data-presentation={view.mode}>
    <div ref={viewport} className="relation-viewport absolute inset-0 overflow-hidden outline-none" aria-label="三维关系图画布" aria-busy={transitioning} tabIndex={0}
      onPointerLeave={() => { setLabel(null); setCanvas(null); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && selectedId) { event.preventDefault(); event.stopPropagation(); onSelect(null); return; }
        if (event.target !== event.currentTarget) return;
        const arrows: Record<string, [number, number]> = { ArrowLeft: [-.12, 0], ArrowRight: [.12, 0], ArrowUp: [0, -.12], ArrowDown: [0, .12] };
        if (arrows[event.key]) { event.preventDefault(); scene.current?.rotate(...arrows[event.key]); }
        if (event.key === '+' || event.key === '=') { event.preventDefault(); scene.current?.zoom(.85); }
        if (event.key === '-') { event.preventDefault(); scene.current?.zoom(1.18); }
        if (event.key === 'Home') { event.preventDefault(); scene.current?.fit(); }
      }}>
      <div ref={host} className="relation-webgl absolute left-0 top-0" />
      <div className="relation-labels pointer-events-none absolute inset-0 overflow-hidden">
        {status === 'ready' ? graph.nodes.filter(node => labelIds.has(node.id)).map(node => <button key={node.id} type="button"
          ref={element => { if (element) buttons.current.set(node.id, element); else buttons.current.delete(node.id); }}
          data-relation-node={node.id} data-kind={node.kind} data-hovered={node.id === hoveredId || undefined} aria-label={relationNodeLabel(node)} aria-pressed={node.id === selectedId}
          className="relation-node-label pointer-events-auto absolute flex items-center rounded px-1.5 py-1 text-xs"
          disabled={transitioning}
          style={{ visibility: 'hidden' }} onClick={() => selectNode(node.id)}
          onPointerEnter={() => setLabel(node.id)} onPointerLeave={() => setLabel(null)}
          onFocus={() => setFocus(node.id)} onBlur={() => setFocus(null)}>
          <span className="truncate">{node.title}</span>
        </button>) : null}
      </div>
      <Popover open={Boolean(selectedId && renderDetails && detailsVisible && active && (planar || status === 'error' || !graph.nodes.some(node => node.id === selectedId)))} onOpenChange={setDetailsVisible}>
        <PopoverAnchor asChild><span ref={anchor} aria-hidden="true" className="pointer-events-none absolute h-3 w-3" style={{ left: '50%', top: '50%' }} /></PopoverAnchor>
        <PopoverContent viewportAligned side="right" align="start" sideOffset={14} collisionBoundary={viewport.current} collisionPadding={12}
          updatePositionStrategy="always" className="relation-detail-bubble gap-0 overflow-hidden p-0" data-compact={planar && (viewport.current?.clientWidth ?? 0) < 880 || undefined} aria-label="关系详情气泡"
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => { event.preventDefault(); if (active) viewport.current?.focus({ preventScroll: true }); }}
          onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setDetailsVisible(false); }}
          onInteractOutside={event => { if ((event.target as Element)?.closest('.relations-page')) event.preventDefault(); }}>
          {renderDetails?.(() => setDetailsVisible(false))}{!planar ? <PopoverArrow className="fill-popover" width={12} height={6} /> : null}
        </PopoverContent>
      </Popover>
    </div>
    {selectedId ? <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border bg-popover/95 p-1 shadow-sm">
      <Button variant="ghost" size="sm" onClick={() => onSelect(null)}><ArrowLeft size={14} />返回三维</Button>
      <span className="pr-2 text-[11px] text-muted-foreground" role="status">{transitioning ? '正在展开关系…' : '二维关系'}</span>
    </div> : null}
    <div className="relation-map-controls absolute right-3 top-3 flex items-center gap-0.5 rounded-lg border bg-popover/95 p-1 shadow-sm">
      {selectedId ? <Button size="sm" variant="ghost" aria-pressed={detailsVisible} onClick={() => setDetailsVisible(value => !value)}><Info size={14} />详情</Button> : null}
      <Popover open={picker && active} onOpenChange={setPicker}><PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" title="选择对象" aria-label="选择对象"><List size={15} /></Button>
      </PopoverTrigger><PopoverContent viewportAligned align="end" aria-label="关系对象列表" className="w-72">
        <p className="text-xs font-medium">当前范围 · {graph.nodes.length} 个对象</p>
        <div className="max-h-64 overflow-y-auto">{graph.nodes.map(node => <Button key={node.id} variant="plain" className="w-full justify-start gap-2 px-2 text-xs"
          onClick={() => { setPicker(false); selectNode(node.id); }}><RelationIcon kind={node.kind} /><span className="truncate">{node.title}</span></Button>)}</div>
      </PopoverContent></Popover>
      <span className="mx-1 h-4 border-l" />
      <Button size="icon-sm" variant="ghost" title="缩小" aria-label="缩小关系图" disabled={status !== 'ready' || transitioning} onClick={() => scene.current?.zoom(1.2)}><Minus size={14} /></Button>
      <Button size="icon-sm" variant="ghost" title="放大" aria-label="放大关系图" disabled={status !== 'ready' || transitioning} onClick={() => scene.current?.zoom(.83)}><Plus size={14} /></Button>
      <Button size="icon-sm" variant="ghost" title={planar ? '适应当前关系' : '查看全图'} aria-label="查看全图" disabled={status !== 'ready' || transitioning} onClick={() => scene.current?.fit()}><Maximize size={14} /></Button>
    </div>
    {status !== 'ready' ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="max-w-xs space-y-2 p-4 text-center text-xs text-muted-foreground" role="status">
      {status === 'loading' ? '正在构建三维关系…' : <><p>暂时无法显示三维视图。仍可通过“选择对象”查看详情。</p><Button className="pointer-events-auto" variant="outline" size="sm" onClick={retry}><RotateCcw size={13} />重试三维视图</Button></>}
    </div></div> : null}
    <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
      <span className="rounded bg-card/85 px-2 py-1">{planar ? `拖动平移 · 滚轮缩放${view.total > view.shown ? ` · 显示 ${view.shown}/${view.total} 个关联，完整列表见详情` : ''}` : '后侧半透明 · 拖动旋转 · 滚轮缩放 · 点击展开关系'}</span>
      <span className="flex gap-3 rounded bg-card/85 px-2 py-1"><span className="relation-legend-tag">● 标签</span><span className="relation-legend-entry">▰ 论文</span><span className="relation-legend-note">◆ 笔记</span></span>
    </div>
    {hovered && hoverAnchor && previewVisible && !selectedId && active ? <PointerPreview anchor={hoverAnchor} width={280} role="tooltip">
      <div className="space-y-1 p-1"><div className="flex items-center gap-1.5 text-xs font-medium"><RelationIcon kind={hovered.kind} />{hovered.title}</div>
        <p className="text-xs text-muted-foreground">{hovered.subtitle}</p>{hovered.tag?.description ? <p className="line-clamp-3 text-xs">{hovered.tag.description}</p> : null}
        <p className="pt-1 text-[11px] text-muted-foreground">点击查看详情与关联</p></div>
    </PointerPreview> : null}
  </div>;
}
