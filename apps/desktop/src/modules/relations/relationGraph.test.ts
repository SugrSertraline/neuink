import { describe, expect, it } from 'vitest';
import { comparisonNote, relationCatalog, relationEntries, relationTags } from '@/dev/relationsFixture';
import { buildRelationGraph, entryNodeId, filterRelationGraph, noteNodeId, RELATION_KINDS, tagNodeId } from './relationGraph';

describe('workspace relation graph', () => {
  const build = () => buildRelationGraph(relationTags, relationEntries, relationCatalog.notes);
  it('includes all explicit relationship types without inventing inherited memberships or paper citations', () => {
    const graph = build();
    expect(new Set(graph.edges.map(edge => edge.kind))).toEqual(new Set(RELATION_KINDS));
    expect(graph.edges.some(edge => edge.from === tagNodeId('software') && edge.to === entryNodeId('paper-a'))).toBe(false);
    expect(graph.edges.some(edge => edge.from.startsWith('entry:') && edge.to.startsWith('entry:'))).toBe(false);
    expect(graph.nodes.some(node => node.id === entryNodeId('unclassified'))).toBe(true);
  });
  it('keeps a single note linked to multiple PDF sources, including unavailable evidence', () => {
    const graph = build(), id = noteNodeId(comparisonNote.target);
    const sources = graph.edges.filter(edge => edge.from === id && edge.kind === 'source');
    expect(sources).toHaveLength(3);
    expect(sources.find(edge => edge.to === entryNodeId('paper-a'))?.evidence[0].canLocate).toBe(true);
    expect(sources.find(edge => edge.to === entryNodeId('deleted'))?.evidence[0]).toMatchObject({ canLocate: false, source: { snapshot_text: expect.stringContaining('已经保存') } });
    expect(graph.nodes.find(node => node.id === entryNodeId('deleted'))).toMatchObject({ title: '原论文已删除', available: false });
  });
  it('deduplicates memberships, note catalog entries and repeated evidence without losing distinct snippets', () => {
    const first = comparisonNote.links[0];
    const note = { ...comparisonNote, links: [first, { ...first, sources: [...first.sources, { ...first.sources[0], segment_uid: 'a2' }] }] };
    const graph = buildRelationGraph(relationTags, [{ ...relationEntries[0], tagIds: ['hci', 'hci'] }], [note, note]);
    expect(graph.nodes.filter(node => node.id === noteNodeId(note.target))).toHaveLength(1);
    expect(graph.edges.filter(edge => edge.kind === 'membership')).toHaveLength(1);
    expect(graph.edges.find(edge => edge.kind === 'source' && edge.to === entryNodeId('paper-a'))?.evidence).toHaveLength(2);
  });
  it('hides deleted notes even if stale entry metadata still contains them', () => {
    const deleted = { ...comparisonNote, target: { owner: { kind: 'entry' as const, entry_id: 'paper-a' }, note_id: 'summary' }, deleted_at: '2026-09-16' };
    const graph = buildRelationGraph(relationTags, relationEntries, [deleted]);
    expect(graph.nodes.some(node => node.kind === 'note')).toBe(false);
    expect(graph.edges.some(edge => edge.kind === 'source')).toBe(false);
  });
  it('retains names of trashed sources, disables navigation and restores sources when entries return', () => {
    const deleted = { ...relationEntries[1], id: 'deleted', title: '已移除的研究' };
    const graph = buildRelationGraph(relationTags, relationEntries, relationCatalog.notes, [deleted]);
    expect(graph.nodes.find(node => node.id === entryNodeId('deleted'))).toMatchObject({ title: deleted.title, subtitle: '原论文已移入回收站', available: false });
    const restored = buildRelationGraph(relationTags, [...relationEntries, deleted], [{ ...comparisonNote, source_statuses: [] }]);
    expect(restored.nodes.find(node => node.id === entryNodeId('deleted'))?.available).toBe(true);
    expect(restored.edges.find(edge => edge.kind === 'source' && edge.to === entryNodeId('deleted'))?.evidence[0].canLocate).toBe(true);
  });
  it('does not lose a later deletion status when an unavailable source was already encountered', () => {
    const graph = buildRelationGraph(relationTags, relationEntries, [{ ...comparisonNote, source_statuses: [] }, comparisonNote]);
    expect(graph.nodes.find(node => node.id === entryNodeId('deleted'))?.subtitle).toBe('原论文已删除');
  });
  it('filters by direct neighbors and selected edge types while keeping search context', () => {
    const graph = build();
    const focused = filterRelationGraph(graph, ['hierarchy'], '', tagNodeId('software'));
    expect(focused.nodes.map(node => node.id).sort()).toEqual(['tag:alignment', 'tag:evaluation', 'tag:software']);
    const search = filterRelationGraph(graph, RELATION_KINDS, 'Bridging', null);
    expect(search.nodes.some(node => node.id === noteNodeId(comparisonNote.target))).toBe(true);
    expect(search.nodes.some(node => node.id === entryNodeId('paper-c'))).toBe(false);
    expect(filterRelationGraph(graph, [], '不存在', null).nodes).toEqual([]);
  });
  it('handles cyclic tag data without recursing indefinitely or duplicating objects', () => {
    const tags = [{ ...relationTags[0], parent_id: 'alignment' }, relationTags[1]];
    const graph = buildRelationGraph(tags, relationEntries, relationCatalog.notes);
    expect(new Set(graph.nodes.map(node => node.id)).size).toBe(graph.nodes.length);
  });
});
