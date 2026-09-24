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
function Fixture({ enabled = true }: { enabled?: boolean }) {
  const { previewWidth, onPointerDown, onKeyDown } = useSidebarResize({ width: 280, min: 220, max: 820, enabled, onCommit: commit });
  return <div data-testid="shell"><div role="separator" aria-label="侧栏" onPointerDown={onPointerDown} onKeyDown={onKeyDown} /><output>{previewWidth ?? 'idle'}</output></div>;
}
beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1250 } as DOMRect);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  commit.mockReset(); document.body.style.cursor = 'crosshair'; document.body.style.userSelect = 'text';
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.style.cssText = ''; });
const begin = () => fireEvent.pointerDown(screen.getByRole('separator'), { clientX: 350, pointerId: 1, button: 0 });
const move = (x = 450, pointerId = 1) => fireEvent.pointerMove(window, { clientX: x, pointerId });
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
    expect(screen.getByRole('status').textContent).toBe('idle');
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
    expect(screen.getByRole('status').textContent).toBe('idle');
  });
  it('supports bounded keyboard adjustments', () => {
    render(<Fixture />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(commit).toHaveBeenLastCalledWith(296);
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
