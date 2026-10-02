// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSidebarResize } from './useSidebarResize';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true; }
}
const commit = vi.fn();
const rendered = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;
function Fixture({ enabled = true }: { enabled?: boolean }) {
  rendered();
  const { previewRef, onPointerDown, onKeyDown } = useSidebarResize({ width: 280, min: 220, max: 820, enabled, onCommit: commit });
  return <div data-testid="shell" className="app-shell"><div role="separator" aria-label="侧栏" onPointerDown={onPointerDown} onKeyDown={onKeyDown} /><div data-testid="preview" ref={previewRef} hidden /></div>;
}
beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  frames.clear(); nextFrameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrameId; frames.set(id, callback); return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1250 } as DOMRect);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  commit.mockReset(); rendered.mockReset(); document.body.style.cursor = 'crosshair'; document.body.style.userSelect = 'text';
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.style.cssText = ''; });
const begin = () => fireEvent.pointerDown(screen.getByRole('separator'), { clientX: 350, pointerId: 1, button: 0 });
const move = (x = 450, pointerId = 1) => fireEvent.pointerMove(window, { clientX: x, pointerId });
const flushFrame = () => act(() => {
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0));
});
const preview = () => screen.getByTestId('preview') as HTMLDivElement;
describe('sidebar resize interaction', () => {
  it('ignores a click or a movement below the drag threshold', () => {
    render(<Fixture />); begin(); move(352); fireEvent.pointerUp(window, { pointerId: 1 });
    expect(commit).not.toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe('text');
  });
  it('converts physical pointer distance at 125% into layout width and commits once', () => {
    render(<Fixture />); begin(); move(); fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(commit).toHaveBeenCalledExactlyOnceWith(360);
  });
  it.each(['Escape', 'pointercancel', 'blur'])('rolls back %s without persisting or leaving text selection disabled', action => {
    render(<Fixture />); begin(); move();
    if (action === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (action === 'blur') fireEvent.blur(window);
    else fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(preview().hidden).toBe(true);
    expect(screen.getByTestId('shell').classList.contains('is-sidebar-resizing')).toBe(false);
    expect(frames.size).toBe(0);
    expect(commit).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe('crosshair');
    expect(document.body.style.userSelect).toBe('text');
    move(600); fireEvent.pointerUp(window, { pointerId: 1 });
    expect(commit).not.toHaveBeenCalled();
  });
  it('ignores a second pointer and cleans up on unmount', () => {
    const { unmount } = render(<Fixture />); begin(); move(500, 2); fireEvent.pointerUp(window, { pointerId: 2 });
    expect(commit).not.toHaveBeenCalled();
    move(); unmount(); move(600); fireEvent.pointerUp(window, { pointerId: 1 });
    expect(commit).not.toHaveBeenCalled();
    expect(document.body.style.userSelect).toBe('text');
  });
  it('cancels a drag if the sidebar is collapsed', () => {
    const { rerender } = render(<Fixture />); begin(); move(); rerender(<Fixture enabled={false} />);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(commit).not.toHaveBeenCalled();
    expect(preview().hidden).toBe(true);
    expect(screen.getByTestId('shell').classList.contains('is-sidebar-resizing')).toBe(false);
  });
  it('supports bounded keyboard adjustments', () => {
    render(<Fixture />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(commit).toHaveBeenLastCalledWith(296);
  });
  it('coalesces pointer movement and moves only the guide without re-rendering the workbench', () => {
    render(<Fixture />);
    const initialRenders = rendered.mock.calls.length;
    begin(); move(); move(480); move(600);
    expect(frames.size).toBe(1);
    expect(commit).not.toHaveBeenCalled();
    flushFrame();
    expect(preview().hidden).toBe(false);
    expect(preview().style.getPropertyValue('--app-sidebar-preview-width')).toBe('480px');
    expect(screen.getByTestId('shell').classList.contains('is-sidebar-resizing')).toBe(true);
    move(650); flushFrame();
    expect(preview().style.getPropertyValue('--app-sidebar-preview-width')).toBe('520px');
    expect(rendered).toHaveBeenCalledTimes(initialRenders);
    // A repeated clamped/layout width needs no new visual frame.
    move(650);
    expect(frames.size).toBe(0);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(commit).toHaveBeenCalledExactlyOnceWith(520);
    expect(preview().hidden).toBe(true);
    expect(preview().style.getPropertyValue('--app-sidebar-preview-width')).toBe('');
    expect(rendered).toHaveBeenCalledTimes(initialRenders);
  });
  it.each([[3000, 820], [-350, 220]])('keeps a preview at pointer %s within its width limits', (x, expectedWidth) => {
    render(<Fixture />); begin(); move(x); flushFrame();
    expect(preview().style.getPropertyValue('--app-sidebar-preview-width')).toBe(`${expectedWidth}px`);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(commit).toHaveBeenCalledExactlyOnceWith(expectedWidth);
  });
  it('keeps an unrelated parent render from resetting the active guide or gesture', () => {
    const view = render(<Fixture />); begin(); move(); flushFrame();
    view.rerender(<Fixture />);
    expect(preview().hidden).toBe(false);
    expect(screen.getByTestId('shell').classList.contains('is-sidebar-resizing')).toBe(true);
    move(600); flushFrame();
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(commit).toHaveBeenCalledExactlyOnceWith(480);
  });
  it('clears the guide after capture loss and ignores a cancelled or late frame', () => {
    const view = render(<Fixture />); begin(); move();
    const lateFrame = [...frames.values()][0];
    fireEvent(screen.getByRole('separator'), new TestPointerEvent('lostpointercapture', { pointerId: 1 }));
    expect(frames.size).toBe(0);
    act(() => lateFrame(0));
    expect(preview().hidden).toBe(true);
    expect(preview().style.getPropertyValue('--app-sidebar-preview-width')).toBe('');
    begin(); move(); flushFrame();
    const node = preview(), shell = screen.getByTestId('shell');
    view.unmount();
    expect(node.hidden).toBe(true);
    expect(node.style.getPropertyValue('--app-sidebar-preview-width')).toBe('');
    expect(shell.classList.contains('is-sidebar-resizing')).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(document.body.style.userSelect).toBe('text');
  });
  it('keeps main content reachable in a narrow window without overwriting the preferred width', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    function NarrowFixture() {
      const ref = useRef<HTMLDivElement>(null);
      const resize = useSidebarResize({ width: 820, min: 220, max: 820, enabled: true, onCommit: commit, containerRef: ref });
      return <div ref={resize.observeContainer} style={{ '--app-activity-width': '48px' } as React.CSSProperties}><output>{resize.effectiveWidth}</output></div>;
    }
    render(<NarrowFixture />);
    expect(screen.getByRole('status').textContent).toBe('432');
    expect(commit).not.toHaveBeenCalled();
  });
  it('rebinds measurement when opening a workspace replaces the shell DOM', () => {
    const observers: { callback: () => void; target?: Element; disconnected: boolean }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      record: typeof observers[number];
      constructor(callback: () => void) { this.record = { callback, disconnected: false }; observers.push(this.record); }
      observe(target: Element) { this.record.target = target; }
      disconnect() { this.record.disconnected = true; }
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.isConnected ? 1200 : 0;
    });
    function WorkspaceFixture({ workspace }: { workspace: string }) {
      const ref = useRef<HTMLDivElement>(null);
      const resize = useSidebarResize({ width: 280, min: 220, max: 820, enabled: true, onCommit: commit, containerRef: ref });
      return <div key={workspace} ref={resize.observeContainer}><div role="separator" onPointerDown={resize.onPointerDown} /><output>{resize.maxWidth}</output></div>;
    }
    const { rerender } = render(<WorkspaceFixture workspace="initial" />);
    const original = observers[0];
    rerender(<WorkspaceFixture workspace="opened" />);
    // Even a queued callback from the removed shell must not clamp the new one.
    act(() => original.callback());
    expect(screen.getByRole('status').textContent).toBe('820');
    expect(original.disconnected).toBe(true);
    expect(observers[observers.length - 1]?.target?.isConnected).toBe(true);
    begin(); move(); fireEvent.pointerUp(window, { pointerId: 1 });
    expect(commit).toHaveBeenCalledExactlyOnceWith(360);
  });
});
