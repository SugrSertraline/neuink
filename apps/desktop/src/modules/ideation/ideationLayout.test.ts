import { expect, it } from 'vitest';
import type { IdeationLink, IdeationState } from '@/shared/ipc/ideationApi';
import { arrangeBoard, graphStructure, nodeHeight, nodeWidth, slotHeight, slotKey } from './ideationLayout';
import { crossesNode, routeBetween, type NodeRect } from './ideationRouting';

const graph: IdeationState = { version: 2, cards: [
  { id: 'problem', entry_id: 'local', title: '研究问题', body: '', kind: 'problem' },
  { id: 'method', entry_id: 'paper', title: '尝试方法', body: '', kind: 'method' },
], placements: [{ id: 'p', card_id: 'problem', x: 100, y: 100 }, { id: 'm', card_id: 'method', x: 100, y: 100 }],
links: [{ id: 'addresses', from: 'm', to: 'p', kind: 'addresses' }] };

function noOverlap(rects: NodeRect[]) {
  rects.forEach((a, i) => rects.slice(i + 1).forEach(b => expect(
    a.x < b.x + nodeWidth && a.x + nodeWidth > b.x && a.y < b.y + (b.height ?? nodeHeight) && a.y + (a.height ?? nodeHeight) > b.y,
  ).toBe(false)));
}
function clearRoute(route: ReturnType<typeof routeBetween>, obstacles: NodeRect[]) {
  expect(route.path).not.toBe('');
  route.points.slice(1).forEach((point, i) => obstacles.forEach(node => expect(crossesNode(route.points[i], point, node)).toBe(false)));
}

it('arranges real nodes and suggestions together with problems before methods, without changing semantic arrows', () => {
  const original = structuredClone(graph), result = arrangeBoard(graph, 'p');
  const p = result.placements.find(n => n.id === 'p')!, m = result.placements.find(n => n.id === 'm')!;
  expect(p.x + nodeWidth).toBeLessThan(m.x);
  expect(new Set(result.slots.map(slot => slot.x)).size).toBe(1);
  const rects = [...result.placements, ...result.slots.map(slot => ({ ...slot, height: slotHeight }))];
  noOverlap(rects);
  clearRoute(routeBetween(m, p, rects, result.routes.addresses), rects);
  result.slots.forEach(slot => clearRoute(routeBetween(p, { ...slot, height: slotHeight }, rects, result.routes[slotKey(slot)]), rects));
  expect(graph).toEqual(original);
  expect(arrangeBoard(graph, 'p')).toEqual(result);
});

it('handles cycles, multi-parent branches, isolated nodes, and parallel relations', () => {
  const state = { ...graph, placements: [...graph.placements, ...['a', 'b', 'c', 'isolated'].map(id => ({ id, card_id: 'method', x: 0, y: 0 }))], links: [
    ...graph.links!, ...[['p', 'a'], ['a', 'b'], ['b', 'p'], ['a', 'c'], ['b', 'c'], ['p', 'a']].map(([from, to], i): IdeationLink => ({ id: `edge${i}`, from, to, kind: 'progression' })),
  ] };
  const result = arrangeBoard(state, 'b'), rects = [...result.placements, ...result.slots.map(slot => ({ ...slot, height: slotHeight }))];
  noOverlap(rects);
  const byId = new Map(result.placements.map(p => [p.id, p]));
  state.links.forEach(link => clearRoute(routeBetween(byId.get(link.from)!, byId.get(link.to)!, rects, result.routes[link.id]), rects));
  result.placements.forEach(p => { expect(Number.isFinite(p.x + p.y)).toBe(true); expect(p.x).toBeLessThanOrEqual(10000); expect(p.y).toBeLessThanOrEqual(10000); });
});

it('keeps locked positions and routes around a manually moved obstacle', () => {
  const state = { ...graph, placements: graph.placements.map(p => p.id === 'p' ? { ...p, locked: true, x: 640, y: 260 } : p) };
  const result = arrangeBoard(state, 'p');
  expect(result.placements[0]).toEqual(state.placements[0]);
  noOverlap([...result.placements, ...result.slots.map(slot => ({ ...slot, height: slotHeight }))]);
  const source = { x: 40, y: 200 }, target = { x: 950, y: 200 }, obstacle = { x: 480, y: 160 };
  clearRoute(routeBetween(source, target, [source, target, obstacle]), [source, target, obstacle]);
});

it('does not invalidate layout on content edits or manual moves but does on topology changes', () => {
  expect(graphStructure({ ...graph, placements: graph.placements.map(p => ({ ...p, x: p.x + 20, body: '局部改写' })) })).toBe(graphStructure(graph));
  expect(graphStructure({ ...graph, links: [] })).not.toBe(graphStructure(graph));
});

it('lays out only the requested empty slot and separates its port from existing arrows', () => {
  const result = arrangeBoard(graph, 'p', 'subproblem');
  expect(result.slots).toHaveLength(1);
  const p = result.placements.find(n => n.id === 'p')!, m = result.placements.find(n => n.id === 'm')!, slot = result.slots[0];
  expect(slot.id).toBe('subproblem');
  expect(Math.abs(slot.y - m.y)).toBeGreaterThanOrEqual(nodeHeight + 60);
  const rects = [...result.placements, slot]; noOverlap(rects);
  const solid = routeBetween(m, p, rects, result.routes.addresses);
  const hint = routeBetween(p, slot, rects, result.routes[slotKey(slot)]);
  clearRoute(solid, rects); clearRoute(hint, rects);
  expect(Math.abs(solid.points[solid.points.length - 1].y - hint.points[0].y)).toBeGreaterThan(20);
});
