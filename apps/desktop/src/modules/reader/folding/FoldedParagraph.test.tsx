// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FoldedParagraph } from './FoldedParagraph';
import type { FoldRecord } from '@/shared/ipc/foldingApi';

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

it('switches from full text to verbatim evidence while keeping original word identity', () => {
  const record: FoldRecord = { segment_uid: 's', source: 'Cats sleep. Dogs run.', evidence: [1], brief: ['Dogs run.'],
    key: 'Dogs run. A finding.', takeaway: 'Dogs run.', topic: 'Dogs', model: 'test', generated_at: '2026-01-01' };
  const view = render(<FoldedParagraph record={record} source={record.source} level="full" />);
  const key = screen.getByText('Dogs').getAttribute('data-fold-token');
  view.rerender(<FoldedParagraph record={record} source={record.source} level="brief" />);
  expect(screen.getByText('Dogs').getAttribute('data-fold-token')).toBe(key);
  expect(screen.queryByText('Cats')).toBeNull();
  expect(screen.getByText('Dogs').closest('[aria-label="作者原文"]')).toBeTruthy();
  view.rerender(<FoldedParagraph record={record} source={record.source} level="key" />);
  expect(screen.getByText('Dogs').closest('[aria-label="AI 生成"]')).toBeTruthy();
});

it('captures the old layout before React changes the tokens and plays the move', () => {
  const record: FoldRecord = { segment_uid: 's', source: 'Cats sleep. Dogs run.', evidence: [1], brief: ['Dogs run.'],
    key: 'Dogs run. A finding.', takeaway: 'Dogs run.', topic: 'Dogs', model: 'test', generated_at: '2026-01-01' };
  const animation = { cancel: vi.fn(), finished: new Promise(() => {}) } as unknown as Animation;
  const animate = vi.fn((_frames: Keyframe[] | PropertyIndexedKeyframes | null, _options?: number | KeyframeAnimationOptions) => animation);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
  const rect = (left: number, width = 20) => ({ left, top: 10, right: left + width, bottom: 26, width, height: 16, x: left, y: 10, toJSON: () => ({}) }) as DOMRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('data-fold-token')) {
      const isFull = this.parentElement?.textContent?.includes('Cats');
      return rect(this.textContent === 'Dogs' && isFull ? 80 : 10);
    }
    return rect(0, 500);
  });
  const view = render(<FoldedParagraph record={record} source={record.source} level="full" />);
  view.rerender(<FoldedParagraph record={record} source={record.source} level="brief" />);
  expect(animate.mock.calls.some(call => JSON.stringify(call[0]).includes('translate(70px, 0px)'))).toBe(true);
  expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  view.unmount();
  expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
});
