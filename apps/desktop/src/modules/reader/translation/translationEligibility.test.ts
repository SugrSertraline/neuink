import { expect, it } from 'vitest';
import { preservesOriginalContent } from './translationEligibility';
it('preserves algorithms/code, tables, images and formulas but translates prose', () => {
  for (const type of ['code', 'table', 'figure', 'math'] as const) expect(preservesOriginalContent(type)).toBe(true);
  for (const type of ['paragraph', 'heading', 'list'] as const) expect(preservesOriginalContent(type)).toBe(false);
});
