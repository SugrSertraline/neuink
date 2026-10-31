import { Graph, layout, type EdgeLabel, type GraphLabel, type NodeLabel, type Point } from '@dagrejs/dagre';
import type { IdeationLink, IdeationState, Placement } from '@/shared/ipc/ideationApi';
import { branchRules, type BranchSlot } from './ideationBranches';
import { relationLabel } from './ideationBoards';

export const nodeWidth = 272, nodeHeight = 218, slotHeight = nodeHeight;
export type LayoutRoute = { points: Point[]; x: number; y: number; from: Point; to: Point };
export type BoardLayout = { placements: Placement[]; slots: BranchSlot[]; routes: Record<string, LayoutRoute> };
export const slotKey = (slot: Pick<BranchSlot, 'sourceId' | 'id'>) => `suggestion:${slot.sourceId}:${slot.id}`;

/** Content edits and manual moves do not trigger rearrangement. */
export function graphStructure(state: IdeationState) {
  const kinds = new Map(state.cards.map(card => [card.id, card.kind]));
  return JSON.stringify([state.placements.map(p => [p.id, p.card_id, kinds.get(p.card_id), Boolean(p.locked)]),
    (state.links ?? []).map(link => [link.id, link.from, link.to, link.kind, link.label])]);
}

/** Presentation direction is independent of the stored semantic arrow. */
function layoutEndpoints(link: IdeationLink) {
  return ['addresses', 'limits', 'supports', 'challenges'].includes(link.kind ?? '')
    ? [link.to, link.from] : [link.from, link.to];
}

export function arrangeBoard(state: IdeationState, sourceId: string | null = null): BoardLayout {
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', ranksep: 100, nodesep: 36, edgesep: 24, marginx: 48, marginy: 48 });
  graph.setDefaultEdgeLabel(() => ({}));
  const source = state.placements.find(p => p.id === sourceId);
  const kind = state.cards.find(card => card.id === source?.card_id)?.kind;
  const slots: BranchSlot[] = source && kind ? branchRules[kind].map(rule => ({ ...rule, sourceId: source.id, x: 0, y: 0 })) : [];
  state.placements.forEach(p => graph.setNode(p.id, { width: nodeWidth, height: nodeHeight }));
  const edges = (state.links ?? []).filter(link => graph.hasNode(link.from) && graph.hasNode(link.to));
  edges.forEach(link => {
    const [from, to] = layoutEndpoints(link);
    graph.setEdge(from, to, { width: Math.min(220, relationLabel(link).length * 13 + 24), height: 26, labelpos: 'c' }, link.id);
  });
  slots.forEach(slot => {
    graph.setNode(slotKey(slot), { width: nodeWidth, height: slotHeight });
    graph.setEdge(slot.sourceId, slotKey(slot), {}, slotKey(slot));
  });
  if (!graph.nodeCount()) return { placements: [], slots: [], routes: {} };
  layout(graph);
  const position = (id: string, height: number) => {
    const node = graph.node(id);
    return { x: Math.round(node.x! - nodeWidth / 2), y: Math.round(node.y! - height / 2) };
  };
  // Fixed nodes retain their position. Other nodes and suggestions avoid their rectangles.
  const occupied = state.placements.filter(p => p.locked).map(p => ({ ...p, height: nodeHeight }));
  const available = (preferred: Point, height: number) => {
    let x = Math.max(0, Math.min(10000, preferred.x)), y = Math.max(0, Math.min(10000, preferred.y));
    for (let attempt = 0; attempt <= occupied.length * 2 + 1; attempt++) {
      const hit = occupied.find(p => x < p.x + nodeWidth + 24 && x + nodeWidth + 24 > p.x && y < p.y + p.height + 24 && y + height + 24 > p.y);
      if (!hit) break;
      y = hit.y + hit.height + 36;
      if (y > 10000) { y = 0; x = (x + nodeWidth + 180) % 10000; }
    }
    occupied.push({ ...preferred, id: '', card_id: '', x, y, height });
    return { x, y };
  };
  const placements = state.placements.map(p => p.locked ? p : { ...p, ...available(position(p.id, nodeHeight), nodeHeight) });
  const byId = new Map(placements.map(p => [p.id, p]));
  slots.forEach(slot => {
    const preferred = position(slotKey(slot), slotHeight);
    const anchor = byId.get(slot.sourceId)!;
    const original = position(slot.sourceId, nodeHeight);
    Object.assign(slot, available({ x: preferred.x + anchor.x - original.x, y: preferred.y + anchor.y - original.y }, slotHeight));
  });
  // Keep the candidate order consistent with the sidebar without changing occupied space.
  const slotPositions = slots.map(({ x, y }) => ({ x, y })).sort((a, b) => a.x - b.x || a.y - b.y);
  slots.forEach((slot, i) => Object.assign(slot, slotPositions[i]));
  const routes: Record<string, LayoutRoute> = {};
  edges.forEach(link => {
    const [from, to] = layoutEndpoints(link), edge = graph.edge({ v: from, w: to, name: link.id });
    if (!edge.points?.length) return;
    const points = from === link.from ? edge.points : [...edge.points].reverse();
    routes[link.id] = { points, x: edge.x ?? points[Math.floor(points.length / 2)].x, y: edge.y ?? points[Math.floor(points.length / 2)].y,
      from: position(link.from, nodeHeight), to: position(link.to, nodeHeight) };
  });
  slots.forEach(slot => {
    const edge = graph.edge({ v: slot.sourceId, w: slotKey(slot), name: slotKey(slot) });
    if (edge.points?.length) routes[slotKey(slot)] = { points: edge.points, ...edge.points[Math.floor(edge.points.length / 2)], from: position(slot.sourceId, nodeHeight), to: position(slotKey(slot), slotHeight) };
  });
  return { placements, slots, routes };
}
