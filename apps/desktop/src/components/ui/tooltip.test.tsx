/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';
import { HOVER_TIMING } from './hover-interactions';

class TestPointerEvent extends MouseEvent {
  pointerType = 'mouse';
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function tick(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
function Demo() {
  return <TooltipProvider><Tooltip><TooltipTrigger asChild><button aria-label="阅读设置">设置</button></TooltipTrigger>
    <TooltipContent>调整阅读显示</TooltipContent></Tooltip></TooltipProvider>;
}
describe('Tooltip', () => {
  it('uses a deliberate delay and the scaled tooltip layer', async () => {
    render(<Demo />);
    const trigger = screen.getByRole('button');
    fireEvent.pointerEnter(trigger);
    fireEvent.pointerMove(trigger);
    await tick(HOVER_TIMING.tooltip - 1);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    await tick(1);
    expect(screen.getByRole('tooltip', { hidden: true })).toBeTruthy();
    expect(document.querySelector('[data-slot="overlay-viewport"]')?.className).toContain('z-[var(--z-tooltip)]');
    fireEvent.pointerDown(trigger, { buttons: 1 });
    fireEvent.pointerUp(trigger);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('opens on keyboard focus without stealing it and cancels when the page changes', async () => {
    render(<Demo />);
    const trigger = screen.getByRole('button');
    act(() => trigger.focus());
    await tick(0);
    expect(screen.getByRole('tooltip', { hidden: true })).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
    fireEvent(window, new Event('neuink:reader-surface-change'));
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not resurrect a delayed tooltip after the window loses focus', async () => {
    render(<Demo />);
    fireEvent.pointerEnter(screen.getByRole('button'));
    fireEvent.pointerMove(screen.getByRole('button'));
    fireEvent.blur(window);
    await tick(1000);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });
});
