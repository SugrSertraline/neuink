import { expect, it } from 'vitest';
import { branchRules } from './ideationBranches';
import { inferRelation, recommendedRelations, relationWarning } from './relationRules';
import type { CardKind } from '@/shared/ipc/ideationApi';
it('uses the same direction and types as every slot rule', () => {
  for (const [source, rules] of Object.entries(branchRules)) for (const rule of rules) for (const target of rule.kinds) {
    expect(recommendedRelations(rule.reverse ? target : source as CardKind, rule.reverse ? source as CardKind : target)).toContain(rule.relation);
  }
});
it('infers only unambiguous semantics and flags reverse or unusual relationships', () => {
  expect(inferRelation('background', 'problem')).toBe('motivates');
  expect(inferRelation('method', 'problem')).toBe('addresses');
  expect(inferRelation('background', 'result')).toBe('related');
  expect(relationWarning('problem', 'method', 'addresses')).toContain('相反方向');
  expect(relationWarning('method', 'problem', 'addresses')).toBe('');
  expect(relationWarning('background', 'background', 'input')).toContain('常见连接');
});
