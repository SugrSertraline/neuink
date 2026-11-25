import type { CardKind, IdeationLinkKind } from '@/shared/ipc/ideationApi';
import { branchRules } from './ideationBranches';
/** Same directed type rules as the + menu. These are heuristics, not evidence. */
export function recommendedRelations(from: CardKind, to: CardKind): IdeationLinkKind[] {
  const forward = branchRules[from].filter(rule => !rule.reverse && rule.kinds.includes(to)).map(rule => rule.relation);
  const reverse = branchRules[to].filter(rule => rule.reverse && rule.kinds.includes(from)).map(rule => rule.relation);
  return [...new Set([...forward, ...reverse])];
}
export function inferRelation(from: CardKind, to: CardKind): IdeationLinkKind {
  const choices = recommendedRelations(from, to).filter(kind => kind !== 'related');
  return choices.length === 1 ? choices[0] : 'related';
}
export function relationWarning(from: CardKind, to: CardKind, kind: IdeationLinkKind) {
  if (kind === 'related' || kind === 'hypothesis') return '关系尚未明确，研究时应作为待验证联系，不能当作执行步骤或证据。';
  if (recommendedRelations(from, to).includes(kind)) return '';
  if (recommendedRelations(to, from).includes(kind)) return '此关系通常采用相反方向，请核对起点和终点。';
  return '此关系不在这两种卡片的常见连接规则中，请说明机制与适用条件；允许探索，但不代表已验证。';
}
