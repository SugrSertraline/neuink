// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAssistantAutoScroll } from './useAssistantAutoScroll';

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useAssistantAutoScroll', () => {
  it('scrolls to the newest content on open and updates', () => {
    const view = render(<Harness contentVersion="1" />);
    const container = view.getByTestId('scroll-container');
    expect(container.scrollTop).toBe(480);

    act(() => {
      Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 720 });
      view.rerender(<Harness contentVersion="2" />);
    });
    expect(container.scrollTop).toBe(720);
  });

  it('stops following after even a small deliberate upward scroll', () => {
    const view = render(<Harness contentVersion="1" />);
    const container = view.getByTestId('scroll-container');
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 685 });
    container.scrollTop = 475;
    fireEvent.scroll(container);

    act(() => {
      Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 900 });
      view.rerender(<Harness contentVersion="2" />);
    });

    expect(container.scrollTop).toBe(475);
    expect(view.getByTestId('at-bottom').textContent).toBe('false');
  });

  it('resumes following when the user explicitly returns to the latest message', () => {
    const view = render(<Harness contentVersion="1" />);
    const container = view.getByTestId('scroll-container');
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 720 });
    container.scrollTop = 120;
    fireEvent.scroll(container);

    fireEvent.click(view.getByRole('button', { name: 'latest' }));

    expect(container.scrollTop).toBe(720);
    expect(view.getByTestId('at-bottom').textContent).toBe('true');
  });
});

function Harness({ contentVersion }: { contentVersion: string }) {
  const { containerRef, contentRef, endRef, forceNextScroll, handleScroll, isAtBottom } = useAssistantAutoScroll({
    contentVersion,
    conversationId: 'conversation-1'
  });
  return (
    <>
      <div
        data-testid="scroll-container"
        ref={(element) => {
          containerRef.current = element;
          if (element && element.scrollHeight === 0) {
            Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 480 });
          }
        }}
        onScroll={handleScroll}
      >
        <div ref={contentRef}>
          content
          <div ref={endRef} />
        </div>
      </div>
      <button aria-label="latest" type="button" onClick={forceNextScroll}>latest</button>
      <span data-testid="at-bottom">{String(isAtBottom)}</span>
    </>
  );
}
