// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { fitTranslation, FittedTranslation } from './FittedTranslation';
afterEach(cleanup);
it('shrinks rendered text into its box without enlarging short text', () => {
  const node = document.createElement('div');
  Object.defineProperties(node, {
    clientWidth: { value: 200 }, clientHeight: { value: 100 },
    scrollWidth: { get: () => 200 },
    scrollHeight: { get: () => parseFloat(node.style.fontSize) * 15 },
  });
  fitTranslation(node, 18);
  expect(parseFloat(node.style.fontSize)).toBeLessThanOrEqual(100 / 15);
  expect(parseFloat(node.style.fontSize)).toBeGreaterThan(6.6);
  fitTranslation(node, 5);
  expect(node.style.fontSize).toBe('5px');
});
it('uses a non-scrolling replacement for missing translation', () => {
  const view = render(<FittedTranslation fontSize={12} missing>缺少翻译</FittedTranslation>);
  expect(view.getByTitle('缺少翻译').className).toContain('overflow-hidden');
  expect(view.getByTitle('缺少翻译').className).not.toContain('overflow-auto');
});
