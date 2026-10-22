// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PdfLayoutAnchor } from './PdfLayoutAnchor';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([1, 1.25])('keeps the same page and relative offset after split and merge at UI scale %s', scale => {
  const ref = createRef<HTMLDivElement>();
  const view = (width: number, zoom = 1, bookMode = false) => <PdfLayoutAnchor scrollRef={ref} pageWidth={width} zoom={zoom} bookMode={bookMode}>
    <div ref={ref} data-testid="scroll"><div data-pdf-page-index="0" style={{ height: width * 2 }} /><div data-pdf-page-index="1" style={{ height: width * 2 }} /></div>
  </PdfLayoutAnchor>;
  const ui = render(view(800)), scroll = ref.current!;
  Object.defineProperty(scroll, 'offsetWidth', { value: 800 });
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800 * scale, 600 * scale));
  scroll.querySelectorAll<HTMLElement>('[data-pdf-page-index]').forEach((page, index) => {
    vi.spyOn(page, 'getBoundingClientRect').mockImplementation(() => {
      const height = parseFloat(page.style.height);
      return new DOMRect(0, (index * height - scroll.scrollTop) * scale, 800 * scale, height * scale);
    });
  });
  scroll.scrollTop = 2200; scroll.scrollLeft = 35;
  const move = vi.fn((options: ScrollToOptions) => { scroll.scrollTop = options.top!; scroll.scrollLeft = options.left!; });
  Object.defineProperty(scroll, 'scrollTo', { value: move });
  ui.rerender(view(400)); expect(scroll.scrollTop).toBe(1100); expect(scroll.scrollLeft).toBe(35);
  ui.rerender(view(800)); expect(scroll.scrollTop).toBe(2200);
  move.mockClear(); ui.rerender(view(1000, 1.25)); expect(move).not.toHaveBeenCalled();
  ui.rerender(view(500, 1.25, true)); expect(move).not.toHaveBeenCalled();
});

it('does not invent positions for loading, empty or hidden documents', () => {
  const ref = createRef<HTMLDivElement>();
  const view = (width: number) => <PdfLayoutAnchor scrollRef={ref} pageWidth={width} zoom={1} bookMode={false}><div ref={ref} /></PdfLayoutAnchor>;
  const ui = render(view(800));
  const move = vi.fn(); Object.defineProperty(ref.current!, 'scrollTo', { value: move });
  ui.rerender(view(400)); expect(move).not.toHaveBeenCalled();
});

it.each(['wheel', 'pointer', 'keyboard', 'navigation', 'resize', 'blur', 'document', 'unmount'])
('holds the same center through delayed page geometry, then releases on %s', interruption => {
  let deliverResize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { deliverResize = () => callback([], this as unknown as ResizeObserver); }
    observe() {}
    disconnect = disconnect;
  });
  const ref = createRef<HTMLDivElement>();
  const view = (zoom: number, documentKey = 'first') => <PdfLayoutAnchor scrollRef={ref} pageWidth={800 * zoom}
    zoom={zoom} bookMode={false} documentKey={documentKey} leftInset={48}>
    <div ref={ref} style={{ overflowAnchor: 'auto' }}><div data-pdf-document-stage>
      <section data-pdf-page-index="1"><div data-guide="pdf-page" style={{ width: 800 * zoom }} /></section>
    </div></div>
  </PdfLayoutAnchor>;
  const ui = render(view(1)), scroll = ref.current!;
  const paper = scroll.querySelector<HTMLElement>('[data-guide="pdf-page"]')!;
  let lateHeight = 0;
  Object.defineProperties(scroll, { offsetWidth: { value: 650 }, clientWidth: { value: 640 }, clientHeight: { value: 480 } });
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 650, 480));
  vi.spyOn(paper, 'getBoundingClientRect').mockImplementation(() => {
    const width = parseFloat(paper.style.width);
    return new DOMRect(60 - scroll.scrollLeft, width * 1.25 + lateHeight - scroll.scrollTop, width, width * 1.5);
  });
  const move = vi.fn(({ left, top }: ScrollToOptions) => { scroll.scrollLeft = left!; scroll.scrollTop = top!; });
  Object.defineProperty(scroll, 'scrollTo', { value: move });
  scroll.scrollTop = 1200; scroll.scrollLeft = 120;
  const bounds = paper.getBoundingClientRect();
  const point = { x: (344 - bounds.left) / bounds.width, y: (240 - bounds.top) / bounds.height };
  ui.rerender(view(1.2));
  expect(scroll.style.overflowAnchor).toBe('none');
  // PDF.js finishes a preceding page's layout after zoom has committed.
  lateHeight = 90;
  act(deliverResize);
  const stable = paper.getBoundingClientRect();
  expect(stable.left + stable.width * point.x).toBeCloseTo(344);
  expect(stable.top + stable.height * point.y).toBeCloseTo(240);
  if (interruption === 'wheel') fireEvent.wheel(scroll, { deltaY: 100 });
  if (interruption === 'pointer') fireEvent.pointerDown(scroll);
  if (interruption === 'keyboard') fireEvent.keyDown(scroll, { key: 'PageDown' });
  if (interruption === 'navigation') { scroll.scrollTop += 50; fireEvent.scroll(scroll); }
  if (interruption === 'resize') fireEvent(window, new Event('resize'));
  if (interruption === 'blur') fireEvent(window, new Event('blur'));
  if (interruption === 'document') ui.rerender(view(1.2, 'second'));
  if (interruption === 'unmount') ui.unmount();
  expect(disconnect).toHaveBeenCalled();
  expect(scroll.style.overflowAnchor).toBe('auto');
  const before = scroll.scrollTop;
  move.mockClear(); lateHeight = 160;
  act(deliverResize);
  expect(move).not.toHaveBeenCalled();
  expect(scroll.scrollTop).toBe(before);
});
