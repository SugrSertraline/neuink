import { readIdeationDraft, type CardKind, type IdeationState, type PaperCard } from '@/shared/ipc/ideationApi';
import { presetEntryId, researchPatternCards } from './patterns/researchPatterns';
import { placeBranchCard, type BranchSlot } from './ideationBranches';
export { presetEntryId, userEntryId } from './patterns/researchPatterns';
export const cardLabels: Record<CardKind, string> = { background: '研究背景', problem: '研究问题', method: '论文解决方法', component: '方法组件', constraint: '研究约束', assumption: '适用条件', result: '论文结果', limitation: '局限', idea: '解决方向' };
export const ideationDragType = 'application/x-neuink-ideation';
export const clamp = (value: number, max: number) => Number.isFinite(value) ? Math.max(-max, Math.min(max, value)) : 0;
const legacyPresetCards: PaperCard[] = [
  ['add', '新增组件', '为现有系统增加一个功能、信号或约束，探索它是否能弥补具体缺口。'],
  ['modify', '修改机制', '改变已有组件的结构、目标或交互方式，观察问题是否缓解。'],
  ['split', '拆分与分治', '将复杂问题拆成可独立处理的子问题，再设计它们的协作方式。'],
  ['combine', '组合已有方法', '把互补的方法或模块组合，检查接口、冲突与适用条件。'],
  ['counterfactual', '反事实与反例', '改变一个条件或构造反例，对照分析哪些因素导致结果变化。'],
  ['constraint', '调整约束', '改变问题的假设、资源限制或优化目标，探索新的可行区域。'],
  ['transfer', '跨领域迁移', '将其他问题中的机制迁移过来，检验前提与目标是否匹配。'],
  ['feedback', '引入反馈', '利用中间结果或外部反馈迭代修正，研究何时能改善系统表现。']
].map(([id, title, body]) => ({ id: `preset-${id}`, entry_id: presetEntryId, kind: 'idea' as const, origin: 'preset' as const, title, body }));
export const presetCards: PaperCard[] = [...researchPatternCards, ...legacyPresetCards];
export type IdeationUpdate = (change: (current: IdeationState) => IdeationState) => void;
export function placeCard(update: IdeationUpdate, card: PaperCard, x: number, y: number, target?: BranchSlot | null) {
  if (card.origin === 'ai_draft') throw new Error('请先核对并确认这张 AI 卡片。');
  update(current => placeBranchCard(current, card, clamp(x, 10000), clamp(y, 10000), target));
}
export async function placeDraftCard(root: string, update: IdeationUpdate, entryId: string, cardId: string, x: number, y: number, target?: BranchSlot | null) {
  const snapshot = await readIdeationDraft(root, entryId);
  const card = snapshot.draft?.status === 'ready' ? snapshot.draft.cards.find(item => item.id === cardId) : undefined;
  if (!card) throw new Error('卡片草稿已更改，请刷新后重试。');
  if (card.origin !== 'ai_reviewed') throw new Error('请先核对并确认这张 AI 卡片。');
  placeCard(update, card, x, y, target);
}
