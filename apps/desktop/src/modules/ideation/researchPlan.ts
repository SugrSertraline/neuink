import { sectionForNode } from './researchWorksheet';
import type { IdeationBoard, IdeationState } from '@/shared/ipc/ideationApi';
import { nodeCard, relationLabel } from './ideationBoards';
import { presetEntryId, userEntryId } from './ideationUtils';

export class ResearchPlanError extends Error {}

export function researchInput(board: IdeationBoard, state: IdeationState, selected: ReadonlySet<string>, goal: string, brief?: { background: string; inputs: string; outputs: string }, orderedMethods = false) {
  const nodes = state.placements.filter(p => selected.has(p.id) && p.board_id === board.id);
  const ids = new Map(nodes.map((p, index) => [p.id, `C${index + 1}`]));
  const cards = nodes.map(node => {
    const stored = state.cards.find(card => card.id === node.card_id);
    if (!stored) throw new ResearchPlanError('卡片已移除，请重新选择。');
    const card = nodeCard(node, stored);
    return { ref: ids.get(node.id)!, nodeId: node.id, cardId: card.id, entryId: card.entry_id,
      title: card.title, kind: card.kind, body: card.body, ...(orderedMethods ? { section: sectionForNode({ ...node,card }) } : {}),
      origin: card.origin ?? 'user', edited: node.title != null || node.body != null,
      personal: card.entry_id === userEntryId, preset: card.entry_id === presetEntryId,
      sources: card.sources ?? [] };
  });
  const links = (state.links ?? []).filter(link => ids.has(link.from) && ids.has(link.to))
    .map((link, index) => ({ ref: `E${index + 1}`, ...(link.direction ? { direction: link.direction } : {}), kind: link.kind ?? 'related', from: ids.get(link.from)!, to: ids.get(link.to)!, relation: relationLabel(link),
      description: link.description, origin: link.origin ?? 'user', sources: link.sources ?? [], entryId: link.entry_id }));
  return { boardId: board.id, title: board.title, description: board.description, goal: goal.trim(), ...(brief ? { brief } : {}), cards, links, ...(orderedMethods ? { methodOrder: cards.filter(c => c.section === 'method').map(c => c.ref) } : {}) };
}
export type ResearchInput = ReturnType<typeof researchInput>;
export type ResearchPoint = { title: string; detail: string; card_refs: string[] };
export type ResearchPlan = { verdict: 'conditional' | 'insufficient' | 'not_recommended'; summary: string;
  background: ResearchPoint[]; core_problem: ResearchPoint[]; solution: ResearchPoint[]; innovations: ResearchPoint[];
  compatibility: ResearchPoint[]; risks: ResearchPoint[]; missing_evidence: ResearchPoint[];
  hypothesis: string; steps: ResearchPoint[]; experiments: ResearchPoint[]; success_criteria: string;
  alternatives: string; novelty: string };
export const verdictLabels = { conditional: '有条件可行', insufficient: '证据不足', not_recommended: '暂不建议' };
export function parseResearchPlan(value: unknown, input: ResearchInput): ResearchPlan {
  if (!value || typeof value !== 'object') throw new ResearchPlanError('模型未返回完整研究方案。');
  const data = value as Record<string, unknown>, refs = new Set(input.cards.map(c => c.ref));
  const string = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 6000) throw new ResearchPlanError('研究方案字段缺失或过长，请重试。');
    return value.trim();
  };
  const points = (key: string, required = false) => {
    const items = data[key];
    if (!Array.isArray(items) || items.length > 20 || (required && !items.length)) throw new ResearchPlanError('研究方案列表不完整，请重试。');
    return items.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new ResearchPlanError('研究方案条目格式无效。');
      const p = item as Record<string, unknown>;
      if (!Array.isArray(p.card_refs) || p.card_refs.length > 40 || p.card_refs.some(ref => typeof ref !== 'string' || !refs.has(ref))) throw new ResearchPlanError('研究方案引用了未选择的卡片，请重试。');
      return { title: string(p.title), detail: string(p.detail), card_refs: [...new Set(p.card_refs as string[])] };
    });
  };
  if (!['conditional', 'insufficient', 'not_recommended'].includes(String(data.verdict))) throw new ResearchPlanError('可行性结论格式无效。');
  return { verdict: data.verdict as ResearchPlan['verdict'], summary: string(data.summary),
    background: points('background', true), core_problem: points('core_problem', true), solution: points('solution', true), innovations: points('innovations', true),
    compatibility: points('compatibility', true), risks: points('risks', true), missing_evidence: points('missing_evidence'),
    hypothesis: string(data.hypothesis), steps: points('steps', true), experiments: points('experiments', true),
    success_criteria: string(data.success_criteria), alternatives: string(data.alternatives), novelty: string(data.novelty) };
}
export function researchPlanMarkdown(plan: ResearchPlan, input: ResearchInput, model: string) {
  const section = (title: string, points: ResearchPoint[]) => `## ${title}\n\n${points.length ? points.map(p => `- **${p.title}**：${p.detail}${p.card_refs.length ? `（${p.card_refs.join('、')}）` : ''}`).join('\n') : '模型未列出；不代表没有缺口。'}`;
  return [`# 研究方案：${input.title}`, `AI 草稿 · ${model} · ${new Date().toISOString()}\n未进行联网新颖性核查，不能视为实验结论。`,
    `## 研究目标\n\n${input.goal}`,
    ...(input.brief ? [`## 用户研究说明\n\n问题背景：${input.brief.background || '待明确'}\n\n已有输入：${input.brief.inputs || '待明确'}\n\n期望输出：${input.brief.outputs || '待明确'}`] : []), section('研究背景', plan.background), section('核心问题', plan.core_problem),
    section('我们提出的解决方案', plan.solution), section('潜在创新点（尚未经查新）', plan.innovations),
    section('可尝试的技术路线', plan.steps), `## 备选路线\n\n${plan.alternatives}`,
    `## 关键待验证假设\n\n${plan.hypothesis}`, section('最小验证计划', plan.experiments),
    `## 建议的成功与停止标准\n\n${plan.success_criteria}`,
    `## 可行性与边界：${verdictLabels[plan.verdict]}\n\n${plan.summary}`,
    section('接口兼容性', plan.compatibility), section('风险与失败条件', plan.risks), section('待补证据', plan.missing_evidence),
    `## 相关工作与查新方向\n\n${plan.novelty}`,
    `## 输入卡片快照\n\n${input.cards.map(c => `### ${c.ref} · ${c.title}\n\n来源：${c.personal ? '用户构思' : c.preset ? '启发模式' : c.entryId}；类型：${c.kind}；${c.edited ? '在本构思中有改写' : c.origin}\n\n${c.body}\n\n${c.sources.map(s => `- 第 ${s.page_idx + 1} 页 / ${s.segment_uid}：${s.quote}`).join('\n')}`).join('\n\n')}`,
    `## 输入关系\n\n${input.links.map(l => `- ${l.ref} · ${l.from} ${l.direction === 'both' ? '↔' : l.direction === 'none' ? '—' : '→'} ${l.to}：${l.relation} [${l.kind}]；${l.description ?? ''}（${l.origin}，关系仍需验证）${l.sources.map(source => `\n  - ${l.entryId ?? '未知论文'} / ${source.segment_uid} / 第 ${source.page_idx + 1} 页：${source.quote}`).join('')}`).join('\n') || '未指定连线；模型提出的组合仅为建议。'}`].join('\n\n');
}
