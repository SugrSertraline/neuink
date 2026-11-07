import { relationWarning } from './relationRules';
import type { ResearchInput } from './researchPlan';
/** Deterministic facts, not model claims or a topological execution schedule. */
export function analyzeResearchGraph(input: ResearchInput) {
  const adjacency = new Map(input.cards.map(card => [card.ref, new Set<string>()]));
  const incoming = new Map(input.cards.map(card => [card.ref, 0]));
  for (const edge of input.links) {
    adjacency.get(edge.from)?.add(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const components: string[][] = [], seen = new Set<string>();
  for (const card of input.cards) {
    if (seen.has(card.ref)) continue;
    const queue = [card.ref], component: string[] = [];
    while (queue.length) {
      const ref = queue.pop()!;
      if (seen.has(ref)) continue;
      seen.add(ref); component.push(ref);
      for (const edge of input.links) {
        if (edge.from === ref) queue.push(edge.to);
        if (edge.to === ref) queue.push(edge.from);
      }
    }
    components.push(component);
  }
  return {
    problem_refs: input.cards.filter(c => c.kind === 'problem').map(c => c.ref),
    isolated_refs: input.cards.filter(c => !adjacency.get(c.ref)?.size && !incoming.get(c.ref)).map(c => c.ref),
    components,
    edges: input.links.map(edge => ({ ref: edge.ref, from: edge.from, to: edge.to, kind: edge.kind, direction: edge.direction ?? 'forward', label: edge.relation })),
    relation_warnings: input.links.flatMap(edge => { const from = input.cards.find(card => card.ref === edge.from), to = input.cards.find(card => card.ref === edge.to); const warning = from && to ? relationWarning(from.kind, to.kind, edge.kind ?? 'related') : '连线端点缺失'; return warning ? [{ ref: edge.ref, warning }] : []; }),
    caveat: '图连通性不是方法可行性；支持、限制与替代边不是执行顺序。孤立节点不得擅自连入方法链。',
  };
}
