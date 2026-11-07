import type { CardKind, IdeationLinkKind, IdeationState, PaperCard } from '@/shared/ipc/ideationApi';

export type BranchRule = { id: string; title: string; description: string; kinds: CardKind[]; relation: IdeationLinkKind; reverse?: boolean };
export type BranchSlot = BranchRule & { sourceId: string; x: number; y: number };
const rule = (id: string, title: string, description: string, kinds: CardKind[], relation: IdeationLinkKind, reverse = false): BranchRule => ({ id, title, description, kinds, relation, reverse });
const methods = rule('method', '尝试已有方法', '从论文中选一个方法，探索它能否解决问题', ['method'], 'addresses', true);
const direction = rule('direction', '探索解决方向', '选择新增、修改、组合或反例等研究方向', ['idea'], 'addresses', true);
const assumptions = rule('assumption', '明确适用条件', '这个方法依赖哪些前提？', ['assumption', 'constraint'], 'depends_on');
const evidence = rule('evidence', '寻找结果依据', '用论文结果支持或检验当前方法', ['result'], 'supports', true);
const limits = rule('limitation', '检查局限与反例', '哪些情况下可能失效？', ['limitation'], 'limits', true);

/** Structural suggestions, not semantic claims about paper relevance or novelty. */
export const branchRules: Record<CardKind, BranchRule[]> = {
  background: [rule('problem', '提出研究问题', '在这一背景下，具体还有什么困难？', ['problem'], 'motivates'), rule('constraint', '补充研究约束', '明确场景、资源或数据的限制', ['constraint'], 'related')],
  problem: [direction, methods, rule('subproblem', '拆分子问题', '把当前困难拆成更具体的问题', ['problem'], 'decomposes'), rule('constraint', '补充约束', '说明解决这个问题需要满足什么', ['constraint', 'assumption'], 'limits', true)],
  idea: [rule('realize', '借鉴论文方法', '找一个可以落实方向的方法', ['method'], 'progression'), rule('combine', '组合方法组件', '挑选可复用的组成部分', ['component'], 'combines'), assumptions, limits],
  method: [rule('component', '拆解方法组件', '查看方法可由哪些部分构成', ['component'], 'decomposes'), rule('alternative', '比较替代方法', '保留另一条可能的解决路径', ['method', 'idea'], 'alternative'), assumptions, evidence, limits],
  component: [rule('combine', '组合其他组件', '选择互补组件，检查接口和作用', ['component'], 'combines'), rule('method', '接入解决方法', '将组件作为方法的输入或一部分', ['method'], 'input'), assumptions, limits],
  constraint: [rule('problem', '限定研究问题', '说明这一约束限制了哪个问题', ['problem'], 'limits'), rule('method', '约束解决方法', '检查哪些方法需要满足此约束', ['method', 'idea'], 'limits')],
  assumption: [rule('method', '支持解决方法', '在该前提下尝试一个方法', ['method', 'idea'], 'supports'), rule('counterexample', '寻找反例', '用已知局限挑战当前前提', ['limitation'], 'challenges', true)],
  result: [rule('method', '支持已有方法', '把结果与待核对的方法联系起来', ['method', 'component'], 'supports'), rule('problem', '引出新问题', '结果还留下了什么未解释的问题？', ['problem'], 'motivates'), limits],
  limitation: [rule('problem', '转化为研究问题', '把失败条件明确为待解决的问题', ['problem'], 'motivates'), direction, methods],
};

export function candidateKinds(kind: CardKind): CardKind[] { return [...new Set(branchRules[kind].flatMap(item => item.kinds))]; }

export function placeBranchCard(state: IdeationState, card: PaperCard, x: number, y: number, target?: BranchSlot | null): IdeationState {
  if (card.origin === 'ai_draft' || state.cards.find(item => item.id === card.id)?.origin === 'ai_draft') throw new Error('请先核对并确认这张 AI 卡片。');
  if (target && (!target.kinds.includes(card.kind) || !state.placements.some(p => p.id === target.sourceId))) throw new Error('这张卡片不符合该位置，或来源节点已被移除。');
  const id = crypto.randomUUID();
  return { ...state, cards: state.cards.some(c => c.id === card.id) ? state.cards : [...state.cards, card],
    placements: [...state.placements, { id, card_id: card.id, x: target?.x ?? x, y: target?.y ?? y }],
    links: target ? [...(state.links ?? []), { id: crypto.randomUUID(), from: target.reverse ? id : target.sourceId, to: target.reverse ? target.sourceId : id, kind: target.relation, origin: 'user' }] : state.links,
  };
}
