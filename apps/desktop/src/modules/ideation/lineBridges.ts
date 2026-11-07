type Point = { x: number; y: number };
type Route = { points: Point[]; path: string };
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
/** Bridge only interior intersections; shared ports and overlapping runs are not crossings. */
export function addLineBridges<T extends Route>(routes: Map<string, T>): Map<string, T> {
  const entries = [...routes.entries()].sort(([a], [b]) => a.localeCompare(b));
  return new Map(entries.map(([id, route], index) => {
    if (route.points.length < 2) return [id, route];
    let path = `M ${route.points[0].x} ${route.points[0].y}`;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i], d = { x: b.x - a.x, y: b.y - a.y }, length = Math.hypot(d.x, d.y);
      const hits: number[] = [];
      if (length > 20) for (const [, other] of entries.slice(0, index)) for (let j = 1; j < other.points.length; j++) {
        const c = other.points[j - 1], e = { x: other.points[j].x - c.x, y: other.points[j].y - c.y }, denominator = cross(d, e);
        if (Math.abs(denominator) < .001) continue;
        const offset = { x: c.x - a.x, y: c.y - a.y }, t = cross(offset, e) / denominator, u = cross(offset, d) / denominator;
        if (t * length > 9 && (1 - t) * length > 9 && u > .001 && u < .999) hits.push(t * length);
      }
      const ux = length ? d.x / length : 0, uy = length ? d.y / length : 0;
      let last = -Infinity;
      for (const at of hits.sort((x, y) => x - y)) {
        if (at - last < 16) continue;
        last = at;
        const x = a.x + ux * at, y = a.y + uy * at;
        path += ` L ${x - ux * 6} ${y - uy * 6} Q ${x - uy * 12} ${y + ux * 12} ${x + ux * 6} ${y + uy * 6}`;
      }
      path += ` L ${b.x} ${b.y}`;
    }
    return [id, { ...route, path }];
  }));
}
