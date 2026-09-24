/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfBookControls } from './PdfBookControls';
import { scrollToPage } from './readerUtils';

vi.mock('./readerUtils', () => ({ scrollToPage: vi.fn() }));
const ref = { current: document.createElement('div') };
beforeEach(() => {
  vi.mocked(scrollToPage).mockClear();
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('side page controls', () => {
  it('disables the first/last unavailable direction and preserves the reading bookmark', () => {
    const view = render(<PdfBookControls scrollRef={ref} nextPage={1} currentPage={1} pageCount={4} resumePageIdx={2} />);
    expect((screen.getByRole('button', { name: '向前翻页' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '向后翻页' }));
    expect(scrollToPage).toHaveBeenLastCalledWith(1, ref.current);
    fireEvent.click(screen.getByRole('button', { name: '回到上次阅读位置，第 3 页' }));
    expect(scrollToPage).toHaveBeenLastCalledWith(2, ref.current);
    view.rerender(<PdfBookControls scrollRef={ref} previousPage={2} currentPage={4} pageCount={4} />);
    expect((screen.getByRole('button', { name: '向后翻页' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('turns exactly once when a drag is followed by the pointer-generated click', () => {
    render(<PdfBookControls scrollRef={ref} nextPage={1} currentPage={1} pageCount={4} />);
    const next = screen.getByRole('button', { name: '向后翻页' });
    fireEvent.pointerDown(next, { button: 0, clientX: 200 });
    fireEvent.pointerUp(next, { button: 0, clientX: 120 });
    fireEvent.click(next);
    expect(scrollToPage).toHaveBeenCalledExactlyOnceWith(1, ref.current);
  });
  it('cancels a drag on Escape and allows the next keyboard activation', () => {
    render(<PdfBookControls scrollRef={ref} previousPage={0} currentPage={2} pageCount={4} />);
    const previous = screen.getByRole('button', { name: '向前翻页' });
    fireEvent.pointerDown(previous, { button: 0, clientX: 100 });
    fireEvent.keyDown(previous, { key: 'Escape' });
    fireEvent.pointerUp(previous, { button: 0, clientX: 200 });
    fireEvent.click(previous);
    expect(scrollToPage).not.toHaveBeenCalled();
    fireEvent.keyDown(previous, { key: 'Enter' });
    fireEvent.click(previous);
    expect(scrollToPage).toHaveBeenCalledExactlyOnceWith(0, ref.current);
  });
});
