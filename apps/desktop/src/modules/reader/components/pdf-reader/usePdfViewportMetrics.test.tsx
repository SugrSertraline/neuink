/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SourceSegment } from '@/shared/types/domain';

import { usePdfViewportMetrics } from './usePdfViewportMetrics';

let viewportWidth = 800;
let resizeObserver: TestResizeObserver | null = null;
let nextAnimationFrameId = 0;
const animationFrames = new Map<number, FrameRequestCallback>();

describe('usePdfViewportMetrics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    viewportWidth = 800;
    resizeObserver = null;
    nextAnimationFrameId = 0;
    animationFrames.clear();

    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
      function clientWidth(this: HTMLElement) {
        return this.dataset.pdfViewport === 'true' ? viewportWidth : 0;
      }
    );
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextAnimationFrameId += 1;
      animationFrames.set(nextAnimationFrameId, callback);
      return nextAnimationFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      animationFrames.delete(id);
    });
  });

  afterEach(() => {
    document.body.classList.remove('is-workspace-split-resizing');
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('remeasures responsively while a split is dragged and exactly when it finishes', () => {
    const view = render(<ViewportHarness segments={[]} />);
    expect(screen.getByTestId('viewport-width').textContent).toBe('800');

    document.body.classList.add('is-workspace-split-resizing');
    viewportWidth = 420;
    act(() => resizeObserver?.notify());
    expect(screen.getByTestId('viewport-width').textContent).toBe('800');

    act(() => vi.advanceTimersByTime(72));
    expect(screen.getByTestId('viewport-width').textContent).toBe('420');

    viewportWidth = 380;
    act(() => resizeObserver?.notify());
    document.body.classList.remove('is-workspace-split-resizing');
    act(() => {
      window.dispatchEvent(new Event('neuink:reader-surface-change'));
      view.rerender(<ViewportHarness segments={[segment('segment-1')]} />);
      flushAnimationFrames();
    });

    expect(screen.getByTestId('viewport-width').textContent).toBe('380');
  });

  it('starts measuring when the PDF viewport mounts after the reader loading state', () => {
    const view = render(<DeferredViewportHarness mounted={false} />);
    expect(resizeObserver).toBeNull();

    view.rerender(<DeferredViewportHarness mounted />);

    expect(resizeObserver).not.toBeNull();
    expect(screen.getByTestId('viewport-width').textContent).toBe('800');

    viewportWidth = 460;
    act(() => resizeObserver?.notify());
    act(() => vi.advanceTimersByTime(240));

    expect(screen.getByTestId('viewport-width').textContent).toBe('460');
  });

  it('remeasures a retained PDF when moving the active note tab into a new split', () => {
    render(<ViewportHarness segments={[]} />);
    const originalViewport = document.querySelector('[data-pdf-viewport="true"]');
    expect(screen.getByTestId('viewport-width').textContent).toBe('800');

    // Opening the note hides, but does not unmount, the PDF. A pending normal
    // resize must not restore the full-pane width after the tab drop.
    viewportWidth = 760;
    act(() => resizeObserver?.notify());
    viewportWidth = 0;
    act(() => {
      resizeObserver?.notify();
      window.dispatchEvent(new Event('neuink:reader-surface-change'));
      flushAnimationFrames();
    });

    // Tab dragging does not use the divider's is-workspace-split-resizing flag.
    // Reveal the same PDF in the narrower left pane and notify the layout owner.
    viewportWidth = 420;
    act(() => {
      window.dispatchEvent(new Event('neuink:reader-surface-change'));
      flushAnimationFrames();
    });

    expect(document.querySelector('[data-pdf-viewport="true"]')).toBe(originalViewport);
    expect(screen.getByTestId('viewport-width').textContent).toBe('420');
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('viewport-width').textContent).toBe('420');

    // Closing the split restores the full width without recreating the reader.
    viewportWidth = 800;
    act(() => {
      window.dispatchEvent(new Event('neuink:reader-surface-change'));
      flushAnimationFrames();
    });
    expect(screen.getByTestId('viewport-width').textContent).toBe('800');
  });
});

function ViewportHarness({ segments }: { segments: SourceSegment[] }) {
  const { bindPdfScrollElement, pdfViewportWidth } = usePdfViewportMetrics({
    notePaneOpen: false,
    segments
  });

  return (
    <div>
      <output data-testid="viewport-width">{pdfViewportWidth}</output>
      <div data-pdf-viewport="true" ref={bindPdfScrollElement} />
    </div>
  );
}

function DeferredViewportHarness({ mounted }: { mounted: boolean }) {
  const { bindPdfScrollElement, pdfViewportWidth } = usePdfViewportMetrics({
    notePaneOpen: false,
    segments: []
  });

  return (
    <div>
      <output data-testid="viewport-width">{pdfViewportWidth}</output>
      {mounted ? <div data-pdf-viewport="true" ref={bindPdfScrollElement} /> : null}
    </div>
  );
}

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {
    resizeObserver = this;
  }

  disconnect() {}

  observe() {}

  unobserve() {}

  notify() {
    this.callback([], this);
  }
}

function flushAnimationFrames() {
  const queued = [...animationFrames.values()];
  animationFrames.clear();
  queued.forEach((callback) => callback(0));
}

function segment(uid: string): SourceSegment {
  return {
    bbox: null,
    markdown: null,
    page_idx: 0,
    segment_type: 'paragraph',
    text: uid,
    uid
  };
}
