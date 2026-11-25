import type { CardKind } from '@/shared/ipc/ideationApi';
export const compactCardLabels: Record<CardKind, string> = { background: '背景', problem: '问题', method: '方法', component: '组件', constraint: '约束', assumption: '假设', result: '结果', limitation: '局限', idea: '构思' };
/** Display only the abstraction; full Markdown and source examples stay in the inspector. */
export function cardSummary(card: { kind: CardKind; body?: string }) {
  const body = card.body ?? '';
  const field = card.kind === 'method' ? '抽象方法' : card.kind === 'component' ? '抽象机制' : null;
  if (field) {
    const match = body.match(new RegExp('(?:^|\\n)\\*\\*' + field + '\\*\\*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[^*]+\\*\\*[:：]|$)'));
    if (match?.[1].trim() && !/^(原文未说明|待补充)$/.test(match[1].trim())) return match[1].trim();
    return '';
  }
  return body.replace(/\*\*([^*]+)\*\*[:：]?/g, '$1：').replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 180) || '点击补充内容';
}

/** Expanded face preview keeps examples in the detail surface. */
export function cardFaceSummary(card: { kind: CardKind; body?: string }) {
  if (card.kind !== 'method' && card.kind !== 'component') {
    return (card.body ?? '').trim();
  }
  const labels = card.kind === 'method' ? ['核心步骤', '输入与输出', '适用条件与边界'] : ['组件作用与接口', '适用条件与边界'];
  const extra = labels.flatMap(label => {
    const value = card.body?.match(new RegExp('(?:^|\\n)\\*\\*' + label + '\\*\\*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[^*]+\\*\\*[:：]|$)'))?.[1].trim();
    return value && !/^(原文未说明|待补充)$/.test(value) ? [`**${label}**：${value}`] : [];
  });
  return [cardSummary(card), ...extra].filter(Boolean).join('\n\n');
}
