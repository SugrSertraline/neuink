import { expect, it } from 'vitest';
import { cardSummary } from './cardPresentation';
it('shows only the abstraction, hiding example and Markdown field labels', () => {
  expect(cardSummary({ kind: 'method', body: '**抽象方法**：迁移教师知识降低推理成本\n\n**原文实例**：模型与数据集的长描述' })).toBe('迁移教师知识降低推理成本');
  expect(cardSummary({ kind: 'component', body: '**抽象机制**：聚合邻域信号\n\n**组件作用与接口**：输入输出' })).toBe('聚合邻域信号');
});
it('does not present a legacy summary as an abstraction', () => {
  const body = '原论文摘要';
  expect(cardSummary({ kind: 'method', body })).toContain('待整理');
  expect(cardSummary({ kind: 'method', body })).not.toContain(body);
});
