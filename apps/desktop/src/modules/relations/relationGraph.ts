import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import { buildTagPathById } from '@/modules/library/utils/tagTree';
import type { CatalogNote, SourceAvailability } from '@/shared/ipc/noteCatalogApi';
import type { NoteTarget, SegmentRef, TagMeta } from '@/shared/types/domain';
import { noteTargetKey } from '@/shared/lib/noteOwner';

export type RelationKind = 'hierarchy' | 'membership' | 'ownership' | 'source';
export const RELATION_LABELS: Record<RelationKind, string> = {
  hierarchy: '标签层级', membership: '论文归属', ownership: '笔记归属', source: '来源引用',
};
export const RELATION_KINDS = Object.keys(RELATION_LABELS) as RelationKind[];
export type RelationNode = {
  id: string; kind: 'tag' | 'entry' | 'note'; title: string; subtitle: string;
  available: boolean; tag?: TagMeta; entry?: LibraryEntry; target?: NoteTarget; note?: CatalogNote;
};
export type RelationEvidence = { source: SegmentRef; message: string; canLocate: boolean; anchorId: string };
export type RelationEdge = { id: string; from: string; to: string; kind: RelationKind; evidence: RelationEvidence[] };
export type RelationGraph = { nodes: RelationNode[]; edges: RelationEdge[] };
export const tagNodeId = (id: string) => `tag:${id}`;
export const entryNodeId = (id: string) => `entry:${id}`;
export const noteNodeId = (target: NoteTarget) => `note:${noteTargetKey(target)}`;

/** Derived from the workspace/catalog only. This view never persists relationships. */
export function buildRelationGraph(tags: TagMeta[], entries: LibraryEntry[], notes: CatalogNote[], trashedEntries: LibraryEntry[] = []): RelationGraph {
  const nodes = new Map<string, RelationNode>(), edges = new Map<string, RelationEdge>();
  const paths = buildTagPathById(tags);
  const activeEntries = new Map(entries.map(entry => [entry.id, entry]));
  const trash = new Map(trashedEntries.map(entry => [entry.id, entry]));
  const addEdge = (from: string, to: string, kind: RelationKind, evidence?: RelationEvidence) => {
    if (from === to) return;
    const id = JSON.stringify([kind, from, to]);
    let edge = edges.get(id);
    if (!edge) { edge = { id, from, to, kind, evidence: [] }; edges.set(id, edge); }
    if (evidence && !edge.evidence.some(item => item.anchorId === evidence.anchorId &&
      item.source.segment_uid === evidence.source.segment_uid && item.source.quote_hash === evidence.source.quote_hash)) edge.evidence.push(evidence);
  };
  const ensureTag = (id: string) => {
    const key = tagNodeId(id);
    if (!nodes.has(key)) nodes.set(key, { id: key, kind: 'tag', title: '标签不可用', subtitle: id, available: false });
    return key;
  };
  const ensureEntry = (id: string, status?: SourceAvailability) => {
    const key = entryNodeId(id);
    const existing = nodes.get(key);
    if (!existing || (!existing.available && existing.subtitle === '来源论文暂不可用' && status && ['entry_deleted', 'entry_trashed'].includes(status.status))) {
      const entry = trash.get(id);
      const message = entry || status?.status === 'entry_trashed' ? '原论文已移入回收站'
        : status?.status === 'entry_deleted' ? '原论文已删除' : '来源论文暂不可用';
      nodes.set(key, { id: key, kind: 'entry', title: entry?.title ?? message, subtitle: message, available: false, entry });
    }
    return key;
  };
  for (const tag of tags) nodes.set(tagNodeId(tag.id), {
    id: tagNodeId(tag.id), kind: 'tag', title: tag.name, subtitle: paths.get(tag.id) ?? tag.name, tag, available: true,
  });
  for (const tag of tags) if (tag.parent_id) addEdge(ensureTag(tag.parent_id), tagNodeId(tag.id), 'hierarchy');
  for (const entry of entries) {
    nodes.set(entryNodeId(entry.id), { id: entryNodeId(entry.id), kind: 'entry', title: entry.title,
      subtitle: entry.pdfFileName ?? '无 PDF', entry, available: true });
    // Only stored assignments are edges. Inherited ancestor counts aren't extra assignments.
    for (const id of new Set(entry.tagIds)) addEdge(ensureTag(id), entryNodeId(entry.id), 'membership');
  }
  const deletedNotes = new Set(notes.filter(note => note.deleted_at).map(note => noteNodeId(note.target)));
  for (const entry of entries) for (const content of entry.contents) {
    const target: NoteTarget = { owner: { kind: 'entry', entry_id: entry.id }, note_id: content.note_id };
    const id = noteNodeId(target);
    if (deletedNotes.has(id)) continue;
    nodes.set(id, { id, kind: 'note', title: content.title, subtitle: '文档笔记', target, available: true });
    addEdge(entryNodeId(entry.id), id, 'ownership');
  }
  for (const note of notes) {
    if (note.deleted_at) continue;
    const id = noteNodeId(note.target), owner = note.target.owner;
    const parent = owner.kind === 'entry' ? ensureEntry(owner.entry_id) : ensureTag(owner.tag_id);
    nodes.set(id, { id, kind: 'note', title: note.title, subtitle: owner.kind === 'entry' ? '文档笔记' : '标签笔记',
      target: note.target, note, available: nodes.get(parent)?.available ?? false });
    addEdge(parent, id, 'ownership');
    const statuses = new Map(note.source_statuses?.map(item => [JSON.stringify([item.entry_id, item.segment_uid, item.quote_hash]), item]));
    for (const link of note.links) for (const source of link.sources) {
      const status = statuses.get(JSON.stringify([source.entry_id, source.segment_uid, source.quote_hash]));
      const entryId = ensureEntry(source.entry_id, status);
      addEdge(id, entryId, 'source', { source, anchorId: link.anchor_id,
        message: status?.message ?? (activeEntries.has(source.entry_id) ? '' : nodes.get(entryId)!.subtitle),
        canLocate: Boolean(activeEntries.get(source.entry_id)?.pdfFileName) && (status?.can_locate ?? true) });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function relationNeighbors(graph: RelationGraph, id: string) {
  const ids = new Set([id]);
  for (const edge of graph.edges) if (edge.from === id || edge.to === id) { ids.add(edge.from); ids.add(edge.to); }
  return ids;
}

export function filterRelationGraph(graph: RelationGraph, kinds: RelationKind[], query: string, focusId: string | null) {
  const edges = graph.edges.filter(edge => kinds.includes(edge.kind));
  let nodes = graph.nodes;
  if (focusId) {
    const neighbors = relationNeighbors({ nodes, edges }, focusId);
    nodes = nodes.filter(node => neighbors.has(node.id));
  }
  const term = query.trim().toLocaleLowerCase();
  if (term) {
    const matches = new Set(nodes.filter(node => `${node.title} ${node.subtitle}`.toLocaleLowerCase().includes(term)).map(node => node.id));
    const related = new Set(matches);
    for (const edge of edges) if (matches.has(edge.from) || matches.has(edge.to)) { related.add(edge.from); related.add(edge.to); }
    nodes = nodes.filter(node => related.has(node.id));
  }
  const ids = new Set(nodes.map(node => node.id));
  return { nodes, edges: edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)) };
}
