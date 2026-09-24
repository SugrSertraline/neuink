import type { NodeObject, LinkObject } from '3d-force-graph';
import type { RelationGraph, RelationNode, RelationEdge } from './relationGraph';

export type SceneNode = NodeObject & { id: string; data: RelationNode; degree: number };
export type SceneLink = LinkObject<SceneNode> & { data: RelationEdge };
export type SceneData = { nodes: SceneNode[]; links: SceneLink[] };
export type NodeProjection = { id: string; x: number; y: number; visible: boolean; depth: number };

/** The force engine mutates its inputs; domain objects and saved evidence stay untouched. */
export function sceneData(graph: RelationGraph, previous: SceneNode[] = []): SceneData {
  const cache = new Map(previous.map(node => [node.id, node]));
  const degree = new Map<string, number>();
  graph.edges.forEach(edge => { degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1); degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1); });
  return {
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(data => {
      const old = cache.get(data.id);
      return { id: data.id, data, degree: degree.get(data.id) ?? 0,
        ...(old && Number.isFinite(old.x) && Number.isFinite(old.y) && Number.isFinite(old.z) ? { x: old.x, y: old.y, z: old.z } : {}) };
    }),
    links: graph.edges.map(data => ({ source: data.from, target: data.to, data })),
  };
}

export function visibleLabels(graph: RelationGraph, selectedId: string | null, hoveredId: string | null) {
  if (graph.nodes.length <= 45) return new Set(graph.nodes.map(node => node.id));
  const adjacent = new Set([selectedId, hoveredId].filter((id): id is string => Boolean(id)));
  for (const edge of graph.edges) if ([selectedId, hoveredId].some(id => id === edge.from || id === edge.to)) {
    adjacent.add(edge.from); adjacent.add(edge.to);
  }
  const active = [selectedId, hoveredId].filter((id): id is string => Boolean(id));
  const priority = [...active.map(id => graph.nodes.find(node => node.id === id)).filter((node): node is RelationNode => Boolean(node)),
    ...graph.nodes.filter(node => adjacent.has(node.id) && !active.includes(node.id))];
  const tags = graph.nodes.filter(node => node.kind === 'tag' && !adjacent.has(node.id));
  return new Set([...priority, ...tags].slice(0, 70).map(node => node.id));
}
