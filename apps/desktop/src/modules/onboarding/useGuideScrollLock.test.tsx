// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGuideScrollLock } from './useGuideScrollLock';

function Harness({ enabled = true }: { enabled?:boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  useGuideScrollLock('[data-target]', undefined, viewport, enabled);
  return <><div style={{ overflowY:'auto' }} data-scroll-owner>
    <div data-target><div style={{ overflowY:'scroll' }} data-scroll-owner>可滚动侧栏</div></div>
  </div><div ref={viewport} data-guide-overlay><p style={{ overflowY:'auto' }} data-scroll-owner>教程正文</p></div></>;
}
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left:0, top:0, right:1200, bottom:800, width:1200, height:800 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function(this:HTMLElement) { return this.hasAttribute('data-scroll-owner') ? 400 : 100; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('locks native scrollbar owners around and inside an observation, but not the guide instructions', () => {
  const view = render(<Harness />);
  const inner = screen.getByText('可滚动侧栏');
  const outer = inner.parentElement!.parentElement!;
  expect(inner.style.overflowY).toBe('hidden');
  expect(outer.style.overflowY).toBe('hidden');
  expect(inner.style.getPropertyValue('scrollbar-gutter')).toBe('stable');
  expect(screen.getByText('教程正文').style.overflowY).toBe('auto');
  inner.scrollTop = 85;
  view.rerender(<Harness enabled={false} />);
  expect(inner.style.overflowY).toBe('scroll');
  expect(outer.style.overflowY).toBe('auto');
  expect(inner.style.getPropertyValue('scrollbar-gutter')).toBe('');
  expect(inner.scrollTop).toBe(85);
});

it('restores exact inline properties on exit without overriding later business changes', () => {
  const view = render(<Harness />);
  const inner = screen.getByText('可滚动侧栏');
  inner.style.setProperty('overflow-y', 'auto');
  view.rerender(<Harness enabled={false} />);
  expect(inner.style.overflowY).toBe('auto');
  view.rerender(<Harness />);
  expect(inner.style.overflowY).toBe('hidden');
  view.unmount();
  expect(inner.style.overflowY).toBe('auto');
});
