// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FoldTranslatedParagraph } from './FoldTranslatedParagraph';

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

it('aligns retained Chinese characters and animates between translated levels', () => {
  const animation = { cancel: vi.fn(), finished: new Promise(() => {}) } as unknown as Animation;
  const animate = vi.fn((_frames: Keyframe[] | PropertyIndexedKeyframes | null) => animation);
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const rect = (left: number, width = 20) => ({ left, top: 10, right: left + width, bottom: 26, width, height: 16, x: left, y: 10, toJSON: () => ({}) }) as DOMRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('data-fold-token')) return rect(this.textContent === '提' && this.parentElement?.textContent?.includes('准确') ? 80 : 10);
    return rect(0, 500);
  });
  const view = render(<FoldTranslatedParagraph text="模型提高准确率。" />);
  const key = screen.getByText('提').getAttribute('data-fold-token');
  view.rerender(<FoldTranslatedParagraph text="模型提高效率。" />);
  expect(screen.getByText('提').getAttribute('data-fold-token')).toBe(key);
  expect(animate.mock.calls.some(call => JSON.stringify(call[0]).includes('translate(70px, 0px)'))).toBe(true);
  expect(screen.getByLabelText('中文译文').textContent).toBe('模型提高效率。');
});
