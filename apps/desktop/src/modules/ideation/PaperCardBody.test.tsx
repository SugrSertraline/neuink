// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PaperCardBody } from './PaperCardBody';
afterEach(cleanup);
it('renders card formulas using math markup instead of raw delimiters', () => {
  const { container } = render(<PaperCardBody card={{ kind: 'method', body: '**抽象方法**：优化 $x^2 + y_1$\n\n**核心步骤**：求解 $$L = \\sum_i x_i^2$$' }} />);
  expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
});
it('does not reserve a body or show a placeholder when the abstraction is missing', () => {
  const { container } = render(<PaperCardBody card={{ kind: 'method', body: '旧论文摘要' }} />);
  expect(container.innerHTML).toBe('');
});
