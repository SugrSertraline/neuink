/** @vitest-environment jsdom */
import { createRef } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ViewportOverlay } from './viewport-overlay';

describe('ViewportOverlay', () => {
  afterEach(cleanup);
  it('leaves existing portals unchanged and forwards their refs', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<ViewportOverlay ref={ref}><div data-testid="content" className="custom">Content</div></ViewportOverlay>);
    expect(container.querySelector('[data-slot="overlay-viewport"]')).toBeNull();
    expect(ref.current).toBe(screen.getByTestId('content'));
    expect(ref.current?.className).toBe('custom');
  });
  it('inherits the scaled containing block for nested popovers without blocking outside pointer events', () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(<ViewportOverlay enabled ref={ref}><div className="custom">
      <ViewportOverlay><div data-testid="nested">Nested</div></ViewportOverlay>
    </div></ViewportOverlay>);
    const wrappers = container.querySelectorAll('[data-slot="overlay-viewport"]');
    expect(wrappers).toHaveLength(2);
    expect(ref.current).toBe(wrappers[0]);
    expect(wrappers[0].className).toContain('pointer-events-none');
    expect(wrappers[0].firstElementChild?.className).toContain('custom');
    expect(wrappers[0].firstElementChild?.className).toContain('pointer-events-auto');
    expect(screen.getByTestId('nested').className).toContain('pointer-events-auto');
  });
  it('allows a nested overlay to explicitly retain its original positioning', () => {
    const { container } = render(<ViewportOverlay enabled><div><ViewportOverlay enabled={false}><div>Unscaled</div></ViewportOverlay></div></ViewportOverlay>);
    expect(container.querySelectorAll('[data-slot="overlay-viewport"]')).toHaveLength(1);
  });
  it('keeps a modal select above the dialog without changing ordinary popover layers', () => {
    const { container } = render(<ViewportOverlay enabled layer="dialog-popover"><div>选择导出格式</div></ViewportOverlay>);
    const wrapper = container.querySelector('[data-slot="overlay-viewport"]')!;
    expect(wrapper.className).toContain('z-[var(--z-dialog-popover)]');
    expect(wrapper.className).not.toContain('z-[var(--z-popover)]');
  });
});
