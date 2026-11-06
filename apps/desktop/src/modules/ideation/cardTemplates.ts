import type { CardKind } from '@/shared/ipc/ideationApi';

/** Markdown is the persisted interchange format, including for older cards. */
export const cardTemplates: Record<CardKind, readonly string[]> = {
  background: ['研究场景', '重要性', '已知进展', '尚存缺口'],
  problem: ['研究对象', '目标', '现有不足', '成功标准'],
  method: ['抽象方法', '核心步骤', '输入与输出', '适用条件与边界', '原文实例', '方法归属'],
  component: ['抽象机制', '组件作用与接口', '适用条件与边界', '原文实例', '组件归属'],
  constraint: ['约束条件', '适用范围', '不满足时的影响'],
  assumption: ['前提假设', '成立依据', '失效条件'],
  result: ['数据集', '实验设置', '对比基线', '指标与结果', '结论边界'],
  limitation: ['失败场景', '限制原因', '作者陈述或推断', '待解决问题'],
  idea: ['研究问题', '拟改变或组合的内容', '预期作用', '依赖条件', '待验证假设', '最小验证实验'],
};
export function cardTemplateText(kind: CardKind) {
  return cardTemplates[kind].map(label => `**${label}**：待补充`).join('\n\n');
}
export function structuredCardBody(kind: CardKind, fields: unknown, fallback: string) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return fallback;
  const values = fields as Record<string, unknown>;
  if (!cardTemplates[kind].some(key => typeof values[key] === 'string' && (values[key] as string).trim())) return fallback;
  return cardTemplates[kind].map(key => {
    const value = values[key];
    return `**${key}**：${typeof value === 'string' && value.trim() ? value.trim().slice(0, 800) : '原文未说明'}`;
  }).join('\n\n');
}
export const cardTemplatePrompt = Object.entries(cardTemplates).filter(([kind]) => kind !== 'idea')
  .map(([kind, fields]) => `${kind}: ${fields.join('、')}`).join('\n');
