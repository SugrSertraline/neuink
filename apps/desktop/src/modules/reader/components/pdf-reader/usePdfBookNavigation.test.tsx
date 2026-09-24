/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { usePdfBookNavigation } from './usePdfBookNavigation';
import { groupSegmentsByPage, scrollToPage, scrollToPdfRect, scrollToSegment } from './readerUtils';
import { revealPdfPage } from './pdfPageNavigation';

const motion = vi.hoisted(() => ({ animate: vi.fn<typeof import('./pdfPageTurn').animatePdfPageTurn>(() => null) }));
vi.mock('./pdfPageTurn', () => ({ animatePdfPageTurn: motion.animate }));
const pages = groupSegmentsByPage([], 5);
const single = pages.map(page => [page]);
const dual = [pages.slice(0, 2), pages.slice(2, 4), pages.slice(4)];
const pdfDocument = { numPages: 5, getPage: async () => ({ getViewport: () => ({ width: 595, height: 842 }) }) } as unknown as PDFDocumentProxy;
const continuous = new Set([2]);

function Harness({ enabled = true, spread = false, id = 'entry' }: { enabled?: boolean; spread?: boolean; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = spread ? dual : single;
  const book = usePdfBookNavigation({ enabled, entryId: id, rows, scrollRef: ref, document: pdfDocument,
    continuousPages: continuous, pageWidth: 600, zoom: 1 });
  return <div ref={ref} data-testid={id} data-current={book.rowIndex} data-width={book.pageWidth}>
    {rows.map((row, index) => <div key={row[0].pageIdx} style={{ display: enabled && index !== book.rowIndex ? 'none' : undefined }}>
      {row.map(page => <section key={page.pageIdx} data-pdf-page-index={page.pageIdx}>
        <div data-pdf-page-surface><span data-segment-uid={`segment-${page.pageIdx}`} /></div>
        <input aria-label={`draft-${page.pageIdx}`} defaultValue="draft survives" />
      </section>)}
    </div>)}
  </div>;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  motion.animate.mockReset().mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('book page navigation', () => {
  it('reveals page and evidence destinations before measuring and preserves page drafts', async () => {
    render(<Harness />);
    const root = screen.getByTestId('entry');
    const draft = screen.getByLabelText('draft-0');
    await act(async () => { expect(scrollToPage(1, root)).toBe(true); });
    expect(root.dataset.current).toBe('1');
    expect(root.scrollTo).toHaveBeenCalled();
    expect(motion.animate).toHaveBeenCalledWith(root, expect.objectContaining({ pageIdx: 0, direction: 1, underPageIdx: 1, onComplete: expect.any(Function) }));
    await act(async () => { expect(scrollToPdfRect(4, [10, 20, 30, 40], root)).toBe(true); });
    expect(root.dataset.current).toBe('4');
    expect(motion.animate).toHaveBeenCalledTimes(1); // Distant evidence jumps do not turn every page.
    await act(async () => { expect(scrollToSegment('segment-0', root)).toBe(true); });
    expect(root.dataset.current).toBe('0');
    expect(screen.getByLabelText('draft-0')).toBe(draft);
  });
  it('maps a destination to its spread and retains the destination through layout changes', async () => {
    const view = render(<Harness spread />);
    const root = screen.getByTestId('entry');
    await act(async () => { scrollToPage(3, root); });
    expect(root.dataset.current).toBe('1');
    view.rerender(<Harness />);
    expect(root.dataset.current).toBe('3');
    view.rerender(<Harness spread />);
    expect(root.dataset.current).toBe('1');
  });
  it('resumes the continuous reading position when entering and exiting book mode', async () => {
    const view = render(<Harness enabled={false} />);
    await act(async () => {});
    view.rerender(<Harness />);
    const root = screen.getByTestId('entry');
    expect(root.dataset.current).toBe('2');
    await act(async () => { scrollToPage(4, root); });
    view.rerender(<Harness enabled={false} />);
    expect(root.dataset.current).toBe('4');
    expect(revealPdfPage(root, 0, vi.fn())).toBe(false);
    view.rerender(<Harness />);
    expect(root.dataset.current).toBe('4');
  });
  it('isolates split panes, rejects nonexistent pages and unregisters on close', async () => {
    const view = render(<><Harness id="left" /><Harness id="right" /></>);
    const left = screen.getByTestId('left'), right = screen.getByTestId('right');
    await act(async () => { scrollToPage(3, left); });
    expect(left.dataset.current).toBe('3'); expect(right.dataset.current).toBe('0');
    expect(scrollToPage(20, left)).toBe(false);
    view.unmount();
    expect(revealPdfPage(left, 0, vi.fn())).toBe(false);
  });
  it.each([false, true])('commits the whole destination only after the paper finishes (spread=%s)', async spread => {
    let finish!: () => void;
    const dispose = vi.fn(), afterReveal = vi.fn(), latestReveal = vi.fn();
    motion.animate.mockImplementation((_root, { onComplete }) => { finish = onComplete!; return dispose; });
    render(<Harness spread={spread} />);
    const root = screen.getByTestId('entry');
    const destination = spread ? 2 : 1;
    await act(async () => { revealPdfPage(root, destination, afterReveal); });
    expect(root.dataset.current).toBe('0');
    expect(afterReveal).not.toHaveBeenCalled();
    expect(motion.animate).toHaveBeenCalledWith(root, expect.objectContaining({ pageIdx: spread ? 1 : 0, direction: 1, underPageIdx: spread ? 3 : 1, backPageIdx: spread ? 2 : undefined }));
    await act(async () => { revealPdfPage(root, destination, latestReveal); });
    expect(motion.animate).toHaveBeenCalledTimes(1); // Repeated clicks don't restart the same turn.
    await act(async () => { finish(); });
    expect(root.dataset.current).toBe('1');
    expect(afterReveal).not.toHaveBeenCalled();
    expect(latestReveal).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });
  it('cancels a stale turn before jumping to a different evidence page', async () => {
    let finish!: () => void;
    const dispose = vi.fn(), staleReveal = vi.fn();
    motion.animate.mockImplementation((_root, { onComplete }) => { finish = onComplete!; return dispose; });
    render(<Harness />);
    const root = screen.getByTestId('entry');
    await act(async () => { revealPdfPage(root, 1, staleReveal); });
    await act(async () => { scrollToPage(4, root); });
    expect(dispose).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    expect(root.dataset.current).toBe('4');
    expect(staleReveal).not.toHaveBeenCalled();
  });
  it('restores the current sheet when layout changes during a turn', async () => {
    let finish!: () => void;
    const dispose = vi.fn();
    motion.animate.mockImplementation((_root, { onComplete }) => { finish = onComplete!; return dispose; });
    const view = render(<Harness />);
    const root = screen.getByTestId('entry');
    await act(async () => { scrollToPage(1, root); });
    view.rerender(<Harness spread />);
    expect(dispose).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
    expect(root.dataset.current).toBe('0');
    view.rerender(<Harness />);
    expect(root.dataset.current).toBe('0');
  });
  it('uses the correct under-page and reverse side when going backwards in a spread', async () => {
    render(<Harness spread />);
    const root = screen.getByTestId('entry');
    await act(async () => { scrollToPage(2, root); });
    await act(async () => { scrollToPage(0, root); });
    expect(motion.animate).toHaveBeenLastCalledWith(root, expect.objectContaining({ pageIdx: 2, direction: -1, underPageIdx: 0, backPageIdx: 1 }));
    await act(async () => { scrollToPage(4, root); });
    expect(root.dataset.current).toBe('2');
  });
  it('reserves room beside the paper for both controls in a narrow pane', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    render(<Harness />);
    await act(async () => {});
    const width = Number(screen.getByTestId('entry').dataset.width);
    expect(width + 88 + 24 + 2).toBeLessThanOrEqual(400);
    expect(width).toBeGreaterThan(200);
  });
});
