import type { CardKind } from '@/shared/ipc/ideationApi';
export const compactCardLabels: Record<CardKind, string> = { background: '背景', problem: '问题', method: '方法', component: '组件', constraint: '约束', assumption: '假设', result: '结果', limitation: '局限', idea: '构思' };
/** Display only the abstraction; full Markdown and source examples stay in the inspector. */
export function cardSummary(card: { kind: CardKind; body?: string }) {
  const body = card.body ?? '';
  const field = card.kind === 'method' ? '抽象方法' : card.kind === 'component' ? '抽象机制' : null;
  if (field) {
    const match = body.match(new RegExp('(?:^|\\n)\\*\\*' + field + '\\*\\*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*[^*]+\\*\\*[:：]|$)'));
    if (match?.[1].trim() && !/^(原文未说明|待补充)$/.test(match[1].trim())) return match[1].trim();
    return '待整理抽象说明 · 查看详情保留原内容';
  }
  return body.replace(/\*\*([^*]+)\*\*[:：]?/g, '$1：').replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 180) || '点击补充内容';
}
