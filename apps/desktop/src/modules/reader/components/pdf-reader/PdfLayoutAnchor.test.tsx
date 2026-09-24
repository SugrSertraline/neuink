// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PdfLayoutAnchor } from './PdfLayoutAnchor';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
