import { expect, it } from 'vitest';
import { cardSummary } from './cardPresentation';
it('shows only the abstraction, hiding example and Markdown field labels', () => {
  expect(cardSummary({ kind: 'method', body: '**抽象方法**：迁移教师知识降低推理成本\n\n**原文实例**：模型与数据集的长描述' })).toBe('迁移教师知识降低推理成本');
  expect(cardSummary({ kind: 'component', body: '**抽象机制**：聚合邻域信号\n\n**组件作用与接口**：输入输出' })).toBe('聚合邻域信号');
});
it('does not present a legacy summary as an abstraction', () => {
  const body = '原论文摘要';
  expect(cardSummary({ kind: 'method', body })).toBe('');
  expect(cardSummary({ kind: 'method', body })).not.toContain(body);
});

it('adds reusable steps to the expanded face without leaking the paper example', async () => {
  const { cardFaceSummary } = await import('./cardPresentation');
  const summary = cardFaceSummary({ kind: 'method', body: '**抽象方法**：知识迁移\n\n**核心步骤**：训练教师后蒸馏学生\n\n**原文实例**：某特定数据集' });
  expect(summary).toContain('训练教师后蒸馏学生');
  expect(summary).not.toContain('某特定数据集');
});
