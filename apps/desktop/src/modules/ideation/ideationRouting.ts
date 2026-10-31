import { nodeHeight, nodeWidth, type LayoutRoute } from './ideationLayout';

type Point = { x: number; y: number };
export type NodeRect = Point & { height?: number };
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const box = (p: NodeRect, padding = 0) => ({ left: p.x - padding, right: p.x + nodeWidth + padding, top: p.y - padding, bottom: p.y + (p.height ?? nodeHeight) + padding });

export function crossesNode(a: Point, b: Point, node: NodeRect, padding = 0) {
  const r = box(node, padding);
  // Open-interior segment/rectangle intersection, including diagonal Dagre segments.
  let lo = 0, hi = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, r.left, r.right], [a.y, b.y - a.y, r.top, r.bottom]]) {
    if (!delta) { if (start <= min || start >= max) return false; }
    else { const t1 = (min - start) / delta, t2 = (max - start) / delta; lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2)); }
  }
  return hi - lo > .00001;
}

function pathResult(points: Point[], label?: Point) {
  const middle = points[Math.floor(points.length / 2)];
  return { points, path: points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '), ...(label ?? middle) };
}

/** Keep Dagre's routes; after a manual move, route through free rectangular gutters. */
export function routeBetween(from: NodeRect, to: NodeRect, nodes: NodeRect[], cached?: LayoutRoute) {
  const clear = (points: Point[], padding = 0) => points.slice(1).every((p, i) => !nodes.some(node => crossesNode(points[i], p, node, padding)));
  if (cached && same(from, cached.from) && same(to, cached.to) && clear(cached.points)) return pathResult(cached.points, cached);
  const forward = to.x >= from.x + nodeWidth, backward = from.x >= to.x + nodeWidth;
  const source: Point = { x: from.x + (forward ? nodeWidth : backward ? 0 : nodeWidth / 2), y: from.y + (forward || backward ? (from.height ?? nodeHeight) / 2 : to.y > from.y ? (from.height ?? nodeHeight) : 0) };
  const target: Point = { x: to.x + (forward ? 0 : backward ? nodeWidth : nodeWidth / 2), y: to.y + (forward || backward ? (to.height ?? nodeHeight) / 2 : to.y > from.y ? 0 : (to.height ?? nodeHeight)) };
  const middleX = (source.x + target.x) / 2, middleY = (source.y + target.y) / 2;
  const direct = forward || backward
    ? [source, { x: middleX, y: source.y }, { x: middleX, y: target.y }, target]
    : [source, { x: source.x, y: middleY }, { x: target.x, y: middleY }, target];
  if (clear(direct)) return pathResult(direct, { x: middleX, y: middleY });
  const pad = 16, direction = forward ? 1 : backward ? -1 : to.y > from.y ? 1 : -1;
  const start = { x: source.x + (forward || backward ? pad * direction : 0), y: source.y + (forward || backward ? 0 : pad * direction) };
  const end = { x: target.x - (forward || backward ? pad * direction : 0), y: target.y - (forward || backward ? 0 : pad * direction) };
  const xs = [...new Set([start.x, end.x, ...nodes.flatMap(n => [n.x - pad, n.x + nodeWidth + pad])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...nodes.flatMap(n => [n.y - pad, n.y + (n.height ?? nodeHeight) + pad])])].sort((a, b) => a - b);
  const cols = xs.length, sourceId = ys.indexOf(start.y) * cols + xs.indexOf(start.x), targetId = ys.indexOf(end.y) * cols + xs.indexOf(end.x);
  const point = (id: number) => ({ x: xs[id % cols], y: ys[Math.floor(id / cols)] });
  const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  // A small binary heap keeps routing responsive for large paper graphs.
  const heap: { id: number; cost: number; priority: number }[] = [];
  const push = (item: typeof heap[number]) => {
    let i = heap.push(item) - 1;
    while (i > 0) { const parent = (i - 1) >> 1; if (heap[parent].priority <= item.priority) break; heap[i] = heap[parent]; i = parent; }
    heap[i] = item;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].priority < heap[child].priority) child++; if (heap[child].priority >= last.priority) break; heap[i] = heap[child]; i = child; }
      heap[i] = last;
    }
    return first;
  };
  const costs = new Map([[sourceId, 0]]), previous = new Map<number, number>();
  push({ id: sourceId, cost: 0, priority: distance(start, end) });
  while (heap.length) {
    const current = pop();
    if (current.cost !== costs.get(current.id)) continue;
    if (current.id === targetId) break;
    const x = current.id % cols, y = Math.floor(current.id / cols), a = point(current.id);
    const neighbors = [x > 0 ? current.id - 1 : -1, x + 1 < cols ? current.id + 1 : -1, y > 0 ? current.id - cols : -1, y + 1 < ys.length ? current.id + cols : -1];
    for (const id of neighbors) {
      if (id < 0) continue;
      const b = point(id), cost = current.cost + distance(a, b);
      if (cost >= (costs.get(id) ?? Infinity) || nodes.some(node => crossesNode(a, b, node, pad - .1))) continue;
      costs.set(id, cost); previous.set(id, current.id); push({ id, cost, priority: cost + distance(b, end) });
    }
  }
  if (!costs.has(targetId)) {
    // Overlapping manually positioned nodes have no clear port. Avoid drawing a misleading line through them.
    return { ...pathResult([] , { x: source.x, y: source.y }), path: '' };
  }
  const middle: Point[] = [end];
  for (let id = targetId; id !== sourceId;) { id = previous.get(id)!; middle.unshift(point(id)); }
  const points = [source, ...middle, target].filter((p, i, all) => i === 0 || i === all.length - 1 || !((all[i - 1].x === p.x && p.x === all[i + 1].x) || (all[i - 1].y === p.y && p.y === all[i + 1].y)));
  // Place the label in a gutter, away from card faces.
  const segments = points.slice(1).map((p, i) => ({ a: points[i], b: p })).sort((a, b) => distance(b.a, b.b) - distance(a.a, a.b));
  const label = segments.find(s => s.a.x === s.b.x) ?? segments[0];
  return pathResult(points, label ? { x: (label.a.x + label.b.x) / 2, y: (label.a.y + label.b.y) / 2 } : undefined);
}
