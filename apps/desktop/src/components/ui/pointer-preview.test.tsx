/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PointerPreview, placePointerPreview, type PreviewAnchor } from './pointer-preview';
import { HOVER_TIMING, useReaderPreviewVisible } from './hover-interactions';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function tick(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }

describe('PointerPreview', () => {
  it('flips near edges and uses the measured height instead of a fixed estimate', () => {
    const anchor = { x: 980, top: 720, bottom: 720 };
    const viewport = { width: 1024, height: 768 };
    const short = placePointerPreview(anchor, { width: 300, height: 150 }, viewport);
    const tall = placePointerPreview(anchor, { width: 300, height: 500 }, viewport);
    expect(short.left).toBe(672);
    expect(short.top).toBe(562);
    expect(tall.top).toBe(212);
  });

  it('converts physical pointer coordinates once at 125% CSS zoom and clamps the card', async () => {
    const rect = (width: number, height: number) => ({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.slot === 'overlay-viewport' ? rect(1000, 750) : rect(400, 250);
    });
    let move: (anchor: PreviewAnchor) => void = () => {};
    render(<PointerPreview anchor={{ x: 500, top: 375, bottom: 375 }} width={320} onMoveReady={(next) => { move = next; }}>预览</PointerPreview>);
    const content = screen.getByText('预览');
    expect(content.style.left).toBe('408px');
    expect(content.style.top).toBe('308px');
    expect(content.style.maxHeight).toBe('576px');
    move({ x: 995, top: 745, bottom: 745 });
    await tick(20);
    expect(content.style.left).toBe('468px');
    expect(content.style.top).toBe('388px');
    expect(content.className).toContain('pointer-events-none');
  });

  it('bounds interactive previews to a narrow viewport and keeps the outside layer transparent to pointers', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(280);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
    render(<PointerPreview anchor={{ x: 40, top: 40, bottom: 40 }} width={720} interactive>长列表</PointerPreview>);
    const content = screen.getByText('长列表');
    expect(content.style.width).toBe('256px');
    expect(content.style.maxHeight).toBe('176px');
    expect(content.className).toContain('pointer-events-auto');
    expect(content.closest('[data-slot="overlay-viewport"]')?.className).toContain('pointer-events-none');
  });
});

function ReaderPreview({ segment = 'one' }) {
  const visible = useReaderPreviewVisible(segment);
  return visible ? <div data-hover-surface="true">阅读预览</div> : null;
}
describe('reader hover timing', () => {
  it('does not flash while crossing a segment and cancels pending work on dismissal', async () => {
    render(<ReaderPreview />);
    await tick(HOVER_TIMING.reader - 1);
    expect(screen.queryByText('阅读预览')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await tick(1000);
    expect(screen.queryByText('阅读预览')).toBeNull();
  });
  it('closes on navigation and can open for the next segment, preserving internal scroll', async () => {
    const view = render(<ReaderPreview />);
    await tick(HOVER_TIMING.reader);
    fireEvent.scroll(screen.getByText('阅读预览'));
    expect(screen.getByText('阅读预览')).toBeTruthy();
    fireEvent(window, new Event('neuink:reader-surface-change'));
    expect(screen.queryByText('阅读预览')).toBeNull();
    view.rerender(<ReaderPreview segment="two" />);
    await tick(HOVER_TIMING.reader);
    expect(screen.getByText('阅读预览')).toBeTruthy();
  });
});
