/** A diagram is a validated presentation artifact, not model-authored Mermaid text. */
export type AssistantDiagramArtifact = {
  kind: 'mindmap' | 'flowchart';
  title: string;
  code: string;
  sourceMarkers: number[];
};

type DiagramNode = { id: string; label: string; parent_id?: string; source_markers?: number[] };
type DiagramEdge = { from: string; to: string; label?: string };

const safeLabel = (value: string) => value.replace(/[\r\n\t]+/g, ' ').replace(/["\\|]/g, '').trim();

export function buildDiagramArtifact(input: unknown, availableMarkers: Set<number>): AssistantDiagramArtifact {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Diagram input must be an object.');
  const value = input as Record<string, unknown>;
  if (value.kind !== 'mindmap' && value.kind !== 'flowchart') throw new Error('Diagram kind must be mindmap or flowchart.');
  if (typeof value.title !== 'string' || !safeLabel(value.title) || value.title.length > 120) throw new Error('Diagram title is invalid.');
  if (!Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > 60) throw new Error('Diagram needs 1–60 nodes.');
  const nodes = value.nodes.map((raw): DiagramNode => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Diagram node is invalid.');
    const node = raw as Record<string, unknown>;
    if (typeof node.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(node.id)) throw new Error('Diagram node id is invalid.');
    if (typeof node.label !== 'string' || !safeLabel(node.label) || node.label.length > 120) throw new Error('Diagram node label is invalid.');
    if (node.parent_id !== undefined && (typeof node.parent_id !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(node.parent_id))) throw new Error('Diagram parent id is invalid.');
    if (node.source_markers !== undefined && (!Array.isArray(node.source_markers) || node.source_markers.some(marker => !Number.isInteger(marker) || !availableMarkers.has(marker)))) throw new Error('Diagram refers to unavailable evidence.');
    return { id: node.id, label: safeLabel(node.label), parent_id: node.parent_id as string | undefined,
      source_markers: node.source_markers as number[] | undefined };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  if (byId.size !== nodes.length) throw new Error('Diagram node ids must be unique.');
  // Model ids are references only. Generated ids cannot collide with Mermaid keywords.
  const renderId = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
  const sourceMarkers = [...new Set(nodes.flatMap(node => node.source_markers ?? []))].sort((a, b) => a - b);
  let code: string;
  if (value.kind === 'mindmap') {
    if (value.edges !== undefined && (!Array.isArray(value.edges) || value.edges.length > 0)) throw new Error('Mind maps use parent_id, not edges.');
    const roots = nodes.filter(node => !node.parent_id);
    if (roots.length !== 1 || nodes.some(node => node.parent_id && !byId.has(node.parent_id))) throw new Error('Mind map needs one root and valid parents.');
    for (const node of nodes) {
      const ancestry = new Set<string>();
      let current: DiagramNode | undefined = node;
      while (current) {
        if (ancestry.has(current.id)) throw new Error('Mind map contains a cycle.');
        ancestry.add(current.id);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
      }
    }
    const children = new Map<string, DiagramNode[]>();
    for (const node of nodes) if (node.parent_id) children.set(node.parent_id, [...(children.get(node.parent_id) ?? []), node]);
    const visited = new Set<string>();
    const lines = ['mindmap'];
    const walk = (node: DiagramNode, depth: number) => {
      if (visited.has(node.id)) throw new Error('Mind map contains a cycle.');
      visited.add(node.id);
      lines.push(`${'  '.repeat(depth)}${renderId.get(node.id)}["${node.label}"]`);
      for (const child of children.get(node.id) ?? []) walk(child, depth + 1);
    };
    walk(roots[0], 1);
    if (visited.size !== nodes.length) throw new Error('Mind map contains disconnected nodes.');
    code = lines.join('\n');
  } else {
    if (nodes.some(node => node.parent_id)) throw new Error('Flowchart nodes cannot have mind-map parents.');
    if (!Array.isArray(value.edges) || value.edges.length > 100) throw new Error('Flowchart edges are invalid.');
    const edges = value.edges.map((raw): DiagramEdge => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Flowchart edge is invalid.');
      const edge = raw as Record<string, unknown>;
      if (typeof edge.from !== 'string' || typeof edge.to !== 'string' || !byId.has(edge.from) || !byId.has(edge.to)) throw new Error('Flowchart edge endpoint is invalid.');
      if (edge.label !== undefined && (typeof edge.label !== 'string' || edge.label.length > 80)) throw new Error('Flowchart edge label is invalid.');
      return { from: edge.from, to: edge.to, label: typeof edge.label === 'string' ? safeLabel(edge.label) : undefined };
    });
    code = ['flowchart TD', ...nodes.map(node => `  ${renderId.get(node.id)}["${node.label}"]`),
      ...edges.map(edge => `  ${renderId.get(edge.from)} -->${edge.label ? `|"${edge.label}"|` : ''} ${renderId.get(edge.to)}`)].join('\n');
  }
  return { kind: value.kind, title: safeLabel(value.title), code, sourceMarkers };
}
