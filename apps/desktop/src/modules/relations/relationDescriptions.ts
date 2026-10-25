import type { RelationEdge, RelationGraph } from './relationGraph';

/** Labels describe the other endpoint relative to the current object. */
export function relationDescription(edge: RelationEdge, selectedId: string): string {
  const outgoing = edge.from === selectedId;
  if (edge.kind === 'hierarchy') return outgoing ? '下级标签' : '上级标签';
  if (edge.kind === 'membership') return outgoing ? '直接归属的条目' : '所属标签';
  if (edge.kind === 'ownership') return outgoing ? '拥有笔记' : '笔记归属';
  return outgoing ? '引用来源' : '引用此条目的笔记';
}

export function relationLabels(graph: RelationGraph, selectedId: string | null): Map<string, string> {
  const labels = new Map<string, Set<string>>();
  if (selectedId) for (const edge of graph.edges) {
    if (edge.from !== selectedId && edge.to !== selectedId) continue;
    const other = edge.from === selectedId ? edge.to : edge.from;
    const values = labels.get(other) ?? new Set<string>();
    values.add(relationDescription(edge, selectedId)); labels.set(other, values);
  }
  return new Map([...labels].map(([id, values]) => [id, [...values].map(value => value === '直接归属的条目' ? '直接条目'
    : value === '引用此条目的笔记' ? '引用它的笔记' : value).join(' · ')]));
}
