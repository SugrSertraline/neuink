// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOVER_TIMING } from '@/components/ui/hover-interactions';

import { EntryTagBadges } from './EntryTagBadges';

class TestPointerEvent extends MouseEvent {
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? 'mouse'; }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  // Radix hides detached anchors; jsdom otherwise reports a zero-sized viewport.
  Object.defineProperties(document.documentElement, { clientWidth: { configurable: true, value: 1024 }, clientHeight: { configurable: true, value: 768 } });
  vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 300, left: 100, right: 260, top: 300, bottom: 324, width: 160, height: 24 } as DOMRect);
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  Reflect.deleteProperty(document.documentElement, 'clientWidth');
  Reflect.deleteProperty(document.documentElement, 'clientHeight');
});
async function tick(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }

describe('EntryTagBadges', () => {
  it.each([false, true])('shows full paths on hover, with tag badges in compact=%s and no row activation', async compact => {
    const onRow = vi.fn();
    const paths = ['软件工程/需求对齐/一个很长的研究主题名称', '方法/同名', '研究/同名'];
    const view = render(<div onClick={onRow}><EntryTagBadges tags={paths} compact={compact} /></div>);
    const trigger = view.getByRole('button', { name: '查看全部 3 个标签' });
    expect(view.getByText('一个很长的研究主题名称').closest('[data-slot=badge]')).toBeTruthy();
    expect(trigger.getAttribute('title')).toBeNull();
    fireEvent.pointerEnter(trigger);
    await tick(HOVER_TIMING.open - 1);
    expect(view.queryByRole('tooltip')).toBeNull();
    await tick(1);
    await tick(32); // Let the portal measure its position before testing visibility.
    const preview = view.getByRole('tooltip', { name: '条目标签' });
    for (const path of paths) expect(within(preview).getByRole('listitem', { name: path })).toBeTruthy();
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(preview);
    await tick(HOVER_TIMING.close + 1);
    expect(view.getByRole('tooltip')).toBe(preview);
    fireEvent.scroll(preview);
    expect(view.getByRole('tooltip')).toBeTruthy();
    expect(onRow).not.toHaveBeenCalled();
    fireEvent.pointerLeave(preview);
    await tick(HOVER_TIMING.close);
    expect(view.queryByRole('tooltip')).toBeNull();
  });

  it('supports keyboard focus and Escape without moving focus to the paper row', async () => {
    const view = render(<EntryTagBadges tags={['软件工程/需求对齐']} compact />);
    const trigger = view.getByRole('button', { name: '查看全部 1 个标签' });
    act(() => trigger.focus());
    await tick(HOVER_TIMING.open);
    await tick(32);
    const preview = view.getByRole('tooltip', { name: '条目标签' });
    expect(trigger.getAttribute('aria-describedby')).toBe(preview.id);
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(view.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not reopen a pending hover during dragging and closes on table scrolling', async () => {
    const view = render(<EntryTagBadges tags={['软件工程/需求对齐']} compact />);
    const trigger = view.getByRole('button', { name: '查看全部 1 个标签' });
    fireEvent.pointerEnter(trigger);
    fireEvent.pointerDown(document.body, { buttons: 1 });
    await tick(HOVER_TIMING.open + 1);
    expect(view.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerUp(document.body);
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(trigger);
    await tick(HOVER_TIMING.open);
    await tick(32);
    expect(view.getByRole('tooltip')).toBeTruthy();
    fireEvent.scroll(document);
    expect(view.queryByRole('tooltip')).toBeNull();
  });

  it('keeps the table cell compact while exposing the complete tag count', () => {
    const { container, getByRole, getByText, queryByText } = render(
      <EntryTagBadges tags={[
        '研究/人工智能/智能体',
        '方法/工具调用',
        '论文/综述',
        '状态/重点'
      ]} />
    );

    expect(getByRole('button', { name: '查看全部 4 个标签' })).toBeTruthy();
    expect(getByText('智能体')).toBeTruthy();
    expect(getByText('工具调用')).toBeTruthy();
    expect(getByText('+2')).toBeTruthy();
    expect(container.querySelector('.entry-tag-badges')).toBeTruthy();
    expect(container.querySelector('.entry-tag-narrow-count')?.textContent).toBe('+3');
    expect(container.querySelector('.entry-tag-compact-count')?.textContent).toContain('4');
    expect(queryByText('综述')).toBeNull();
  });

  it('renders a neutral empty state without a hover trigger', () => {
    const { getByText, queryByRole } = render(<EntryTagBadges tags={[]} />);

    expect(getByText('无标签')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });
});
