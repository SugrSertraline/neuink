// @vitest-environment jsdom
import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceSegment } from '@/shared/types/domain';
import { ReadingNavigationScope, useReadingNavigation, type ReadingTarget } from './ReadingNavigation';
import { usePdfReadingNavigation } from './usePdfReadingNavigation';
import { scrollToPage, scrollToPdfRect } from '../pdf-reader/readerUtils';

vi.mock('../pdf-reader/readerUtils', () => ({ scrollToPage: vi.fn(() => true), scrollToPdfRect: vi.fn(() => false), scrollToSegment: vi.fn(() => true) }));
const source: SourceSegment = { uid: 'source', text: 'First paragraph', markdown: null, page_idx: 0, bbox: [100, 100, 900, 200], segment_type: 'paragraph' };
const sources = [source];
function Harness({ target, flash }: { target: ReadingTarget; flash: (uid: string) => void }) {
  const ref = useRef<HTMLDivElement>(null), nav = useReadingNavigation()!;
  usePdfReadingNavigation(ref, sources, true, flash);
  return <div ref={ref} tabIndex={-1}><button onClick={() => nav.navigate(target)}>jump</button></div>;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
describe('PDF reference navigation adapter', () => {
  it('restores zoom before calculating the original page offset', async () => {
    const flash = vi.fn();
    function ZoomReader() {
      const ref = useRef<HTMLDivElement>(null), nav = useReadingNavigation()!;
      const [zoom, setZoom] = useState(1);
      usePdfReadingNavigation(ref, sources, true, flash, { value: zoom, restore: setZoom });
      return <div ref={ref} data-testid="viewport" data-zoom={zoom}>
        <div data-pdf-page-index="0" />
        <button onClick={() => nav.navigate({ pageIdx: 3 })}>jump</button>
        <button onClick={() => setZoom(2)}>zoom</button><button onClick={nav.back}>back</button>
      </div>;
    }
    const ui = render(<ReadingNavigationScope><ZoomReader /></ReadingNavigationScope>);
    const viewport = ui.getByTestId('viewport'), page = viewport.querySelector<HTMLElement>('[data-pdf-page-index]')!;
    viewport.scrollTop = 250;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 500));
    vi.spyOn(page, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, -viewport.scrollTop, 500, Number(viewport.dataset.zoom) * 1000));
    const scroll = vi.fn((options: ScrollToOptions) => { viewport.scrollTop = options.top ?? 0; });
    Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: scroll });
    fireEvent.click(screen.getByText('jump'));
    fireEvent.click(screen.getByText('zoom'));
    viewport.scrollTop = 1200;
    fireEvent.click(screen.getByText('back'));
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 250, left: 0, behavior: 'auto' }));
    expect(viewport.dataset.zoom).toBe('1');
  });
  it('does not borrow a paragraph position for a page-only PDF destination', () => {
    const flash = vi.fn();
    render(<ReadingNavigationScope><Harness target={{ pageIdx: 3 }} flash={flash} /></ReadingNavigationScope>);
    fireEvent.click(screen.getByText('jump'));
    expect(scrollToPage).toHaveBeenCalledWith(3, expect.any(HTMLElement));
    expect(scrollToPdfRect).toHaveBeenCalledWith(3, undefined, expect.any(HTMLElement));
    expect(flash).not.toHaveBeenCalled();
  });
  it('uses and highlights the bibliography segment for a parsed fallback', () => {
    const flash = vi.fn();
    render(<ReadingNavigationScope><Harness target={{ pageIdx: 0, segmentUid: source.uid }} flash={flash} /></ReadingNavigationScope>);
    fireEvent.click(screen.getByText('jump'));
    expect(scrollToPdfRect).toHaveBeenCalledWith(0, source.bbox, expect.any(HTMLElement));
    expect(flash).toHaveBeenCalledWith(source.uid);
  });
});
