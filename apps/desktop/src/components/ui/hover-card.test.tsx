/** @vitest-environment jsdom */
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { HOVER_TIMING, useReaderSelectionPriority } from './hover-interactions';

class TestPointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? 'mouse'; }
}

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('PointerEvent', TestPointerEvent); });
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function tick(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
function Demo({ action = () => {}, changed = (_: boolean) => {} }) {
  return <HoverCard onOpenChange={changed}>
    <HoverCardTrigger asChild><button>预览条目</button></HoverCardTrigger>
    <HoverCardContent><div data-testid="scroll-content">条目完整摘要<button onClick={action}>打开论文</button></div></HoverCardContent>
  </HoverCard>;
}
async function hover() { fireEvent.pointerEnter(screen.getByText('预览条目')); await tick(HOVER_TIMING.open); }

describe('shared hover contract', () => {
  it.each(['pdf-text-layer', 'reflow'])('keeps %s text selection above hover after pointer release, then recovers without a cooldown', async (kind) => {
    render(<><Demo /><p className={kind === 'pdf-text-layer' ? kind : undefined}
      data-reading-selection-source={kind === 'reflow' ? 'segment-1' : undefined}>Selected passage</p></>);
    await hover();
    const range = document.createRange();
    range.selectNodeContents(screen.getByText('Selected passage'));
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    expect(screen.queryByText('条目完整摘要')).toBeNull();
    fireEvent.pointerUp(document.body);
    fireEvent.pointerMove(screen.getByText('预览条目'), { buttons: 0 });
    await tick(0);
    expect(screen.queryByText('条目完整摘要')).toBeNull();
    window.getSelection()!.removeAllRanges();
    fireEvent(document, new Event('selectionchange'));
    fireEvent.pointerMove(screen.getByText('预览条目'), { buttons: 0 });
    await tick(0);
    expect(screen.getByText('条目完整摘要')).toBeTruthy();
  });

  it('dismisses previews while selection tools own priority, including input focus and multiple owners', async () => {
    function Owner({ active }: { active: boolean }) { useReaderSelectionPriority(active); return null; }
    const view = (first: boolean, second: boolean) => <><Demo /><Owner active={first} /><Owner active={second} /><input aria-label="选区批注" /></>;
    const ui = render(view(false, false));
    await hover();
    ui.rerender(view(true, true));
    expect(screen.queryByText('条目完整摘要')).toBeNull();
    act(() => screen.getByLabelText('选区批注').focus());
    fireEvent.pointerMove(screen.getByText('预览条目'), { buttons: 0 });
    expect(screen.queryByText('条目完整摘要')).toBeNull();
    ui.rerender(view(false, true));
    await hover();
    expect(screen.queryByText('条目完整摘要')).toBeNull();
    ui.rerender(view(false, false));
    fireEvent.pointerMove(screen.getByText('预览条目'), { buttons: 0 });
    await tick(0);
    expect(screen.getByText('条目完整摘要')).toBeTruthy();
  });

  it('allows selecting and copying text within an existing hover preview', async () => {
    render(<Demo />);
    await hover();
    const range = document.createRange();
    range.selectNodeContents(screen.getByTestId('scroll-content'));
    window.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    expect(screen.getByText('条目完整摘要')).toBeTruthy();
  });
  it('reopens on movement over the same trigger after scroll without requiring a leave', async () => {
    render(<Demo />);
    await hover();
    fireEvent.scroll(document);
    expect(screen.queryByText('条目完整摘要')).toBeNull();
    fireEvent.pointerMove(screen.getByText('预览条目'));
    expect(screen.getByText('条目完整摘要')).toBeTruthy();
  });
  it('supports explicitly clickable full-text previews without waiting for hover', async () => {
    render(<HoverCard><HoverCardTrigger asChild openOnClick><button>更多摘要</button></HoverCardTrigger><HoverCardContent>完整文本</HoverCardContent></HoverCard>);
    const trigger = screen.getByText('更多摘要');
    fireEvent.pointerDown(trigger, { buttons: 1 });
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);
    await tick(0);
    expect(screen.getByText('完整文本')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('完整文本')).toBeNull();
  });
  it('opens immediately and allows moving into the preview to scroll, select and act', async () => {
    const action = vi.fn();
    render(<Demo action={action} />);
    const trigger = screen.getByText('预览条目');
    fireEvent.pointerEnter(trigger);
    await tick(0);
    const content = screen.getByTestId('scroll-content');
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(content.closest('[data-hover-surface]')!);
    await tick(HOVER_TIMING.open);
    fireEvent.scroll(content);
    fireEvent.pointerDown(content, { buttons: 1 });
    fireEvent.pointerUp(content);
    fireEvent.click(screen.getByText('打开论文'));
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByText('条目完整摘要')).toBeTruthy();
    fireEvent.pointerLeave(content.closest('[data-hover-surface]')!);
    await tick(HOVER_TIMING.close);
    expect(screen.queryByText('条目完整摘要')).toBeNull();
  });

  it.each(['blur', 'resize', 'neuink:reader-surface-change'])('dismisses an immediate preview on %s', async (type) => {
    render(<Demo />);
    fireEvent.pointerEnter(screen.getByText('预览条目'));
    await tick(0);
    fireEvent(window, new Event(type));
    await tick(1000);
    expect(screen.queryByText('条目完整摘要')).toBeNull();
    fireEvent.pointerLeave(screen.getByText('预览条目'));
    await hover();
    expect(screen.getByText('条目完整摘要')).toBeTruthy();
    fireEvent(window, new Event(type));
    expect(screen.queryByText('条目完整摘要')).toBeNull();
  });

  it('dismisses on outside scroll, Escape and context menu', async () => {
    render(<Demo />);
    for (const event of ['scroll', 'keydown', 'contextmenu']) {
      await hover();
      expect(screen.getByText('条目完整摘要')).toBeTruthy();
      if (event === 'keydown') fireEvent.keyDown(document, { key: 'Escape' });
      else fireEvent(document, new Event(event));
      expect(screen.queryByText('条目完整摘要')).toBeNull();
      fireEvent.pointerLeave(screen.getByText('预览条目'));
    }
  });

  it('does not open during a pointer resize or native drag, then recovers', async () => {
    render(<Demo />);
    fireEvent.pointerDown(document.body, { buttons: 1 });
    await hover();
    expect(screen.queryByText('条目完整摘要')).toBeNull();
    fireEvent.pointerUp(document.body);
    fireEvent.pointerLeave(screen.getByText('预览条目'));
    fireEvent.dragStart(document.body);
    await hover();
    expect(screen.queryByText('条目完整摘要')).toBeNull();
    fireEvent.dragEnd(document.body);
    fireEvent.pointerLeave(screen.getByText('预览条目'));
    await hover();
    expect(screen.getByText('条目完整摘要')).toBeTruthy();
  });

  it('keeps keyboard focus on the trigger and reports a controlled close once', async () => {
    const changed = vi.fn();
    function Controlled() {
      const [open, setOpen] = useState(false);
      return <HoverCard open={open} onOpenChange={(next) => { changed(next); setOpen(next); }}>
        <HoverCardTrigger asChild><button>预览条目</button></HoverCardTrigger><HoverCardContent>条目完整摘要</HoverCardContent>
      </HoverCard>;
    }
    render(<Controlled />);
    act(() => screen.getByText('预览条目').focus());
    await tick(HOVER_TIMING.open);
    expect(screen.getByText('条目完整摘要')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByText('预览条目'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(changed.mock.calls).toEqual([[true], [false]]);
    expect(document.activeElement).toBe(screen.getByText('预览条目'));
  });

  it('inherits the dialog layer without closing the dialog with its first Escape', async () => {
    render(<Dialog defaultOpen><DialogContent><DialogTitle>翻译任务</DialogTitle><Demo /></DialogContent></Dialog>);
    await hover();
    const content = screen.getByText('条目完整摘要').closest('[data-slot="overlay-viewport"]');
    expect(content?.className).toContain('z-[var(--z-dialog-popover)]');
    fireEvent.keyDown(screen.getByText('预览条目'), { key: 'Escape' });
    expect(screen.queryByText('条目完整摘要')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(screen.getByText('预览条目'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancels pending work when a row unmounts', async () => {
    const changed = vi.fn();
    const { unmount } = render(<Demo changed={changed} />);
    fireEvent.pointerEnter(screen.getByText('预览条目'));
    unmount();
    await tick(1000);
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector('[data-slot="overlay-viewport"]')).toBeNull();
  });
});
