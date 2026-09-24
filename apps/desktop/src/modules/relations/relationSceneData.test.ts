import { describe, expect, it } from 'vitest';
import { relationTags, relationEntries, relationCatalog } from '@/dev/relationsFixture';
import { buildRelationGraph } from './relationGraph';
import { sceneData, visibleLabels } from './relationSceneData';

describe('3D graph data boundary', () => {
  const graph = buildRelationGraph(relationTags, relationEntries, relationCatalog.notes);
  it('isolates mutable simulation coordinates and links from the source graph', () => {
    const before = JSON.stringify(graph), data = sceneData(graph);
    data.nodes[0].x = 100; data.nodes[0].vx = 12; data.links[0].source = data.nodes[0];
    expect(JSON.stringify(graph)).toBe(before);
    expect(data.links[0].data).toEqual(graph.edges[0]);
  });
  it('keeps finite 3D coordinates across refreshes and drops invalid positions', () => {
    const previous = sceneData(graph).nodes;
    Object.assign(previous[0], { x: 10, y: 20, z: 30, vx: 50 });
    Object.assign(previous[1], { x: NaN, y: 20, z: 30 });
    const next = sceneData(graph, previous);
    expect(next.nodes[0]).toMatchObject({ x: 10, y: 20, z: 30 }); expect(next.nodes[0].vx).toBeUndefined();
    expect(next.nodes[1].x).toBeUndefined();
  });
  it('keeps deterministic input order and bounded labels while preserving active objects', () => {
    expect(sceneData({ ...graph, nodes: [...graph.nodes].reverse() }).nodes.map(n => n.id)).toEqual(sceneData(graph).nodes.map(n => n.id));
    const large = { ...graph, nodes: [...graph.nodes, ...Array.from({ length: 500 }, (_, i) => ({ ...graph.nodes[0], id: 'extra-' + i }))] };
    const labels = visibleLabels(large, 'extra-499', 'extra-498');
    expect(labels.size).toBeLessThanOrEqual(70); expect(labels.has('extra-499')).toBe(true); expect(labels.has('extra-498')).toBe(true);
    const crowded = { ...large, edges: large.nodes.slice(0, 200).map((node, i) => ({ id: 'crowded-' + i, from: 'extra-499', to: node.id, kind: 'membership' as const, evidence: [] })) };
    expect(visibleLabels(crowded, 'extra-499', 'extra-498').has('extra-499')).toBe(true);
  });
});
