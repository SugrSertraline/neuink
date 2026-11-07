import type { IdeationState } from '@/shared/ipc/ideationApi';
export const board = { id: 'board', title: '低成本预测', description: '', created_at: '', updated_at: '' };
export const state: IdeationState = { version: 2, boards: [board], cards: [
  { id: 'paper-card', entry_id: 'paper', kind: 'method', title: '蒸馏', body: '教师迁移到学生', origin: 'ai_reviewed', sources: [{ segment_uid: 'seg-1', page_idx: 0, quote: '原文' }] },
  { id: 'idea', entry_id: 'ideation-user', kind: 'idea', title: '我的假设', body: '替换学生' }],
  placements: [{ id: 'n1', board_id: board.id, card_id: 'paper-card', x: 0, y: 0, body: '本画布的改写' }, { id: 'n2', board_id: board.id, card_id: 'idea', x: 40, y: 40 }],
  links: [{ id: 'link', from: 'n1', to: 'n2', kind: 'combines', origin: 'user' }] };
export const plan = { background: [{ title: '背景', detail: '已有预测方法成本高', card_refs: ['C1'] }], core_problem: [{ title: '问题', detail: '降低成本', card_refs: ['C1'] }], solution: [{ title: '方案', detail: '迁移到学生', card_refs: ['C1','C2'] }], innovations: [{ title: '潜在创新', detail: '学生替换待验证', card_refs: ['C2'] }], verdict: 'conditional', summary: '需要验证', compatibility: [{ title: '接口', detail: '核对输出', card_refs: ['C1'] }],
  risks: [{ title: '风险', detail: '分布改变', card_refs: ['C2'] }], missing_evidence: [], hypothesis: '低成本保持精度',
  steps: [{ title: '步骤', detail: '训练学生', card_refs: ['C1', 'C2'] }], experiments: [{ title: '实验', detail: '对照与消融', card_refs: [] }],
  success_criteria: '预先定义指标', alternatives: '保留教师', novelty: '待检索' };
