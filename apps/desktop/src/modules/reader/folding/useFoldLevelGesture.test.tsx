// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFoldLevelGesture } from './useFoldLevelGesture';
import type { FoldLevel } from './useFoldReader';

let now = 0;
beforeEach(() => { now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now); });
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); });

function Paragraph({ name, enabled = true, initial = 'full', change = vi.fn() }: {
  name: string; enabled?: boolean; initial?: FoldLevel; change?: (level: FoldLevel) => void;
}) {
  const [level, setLevel] = useState(initial);
  const ref = useFoldLevelGesture({ enabled, level, scope: name, onInteraction: () => {},
    onChange: next => { change(next); setLevel(next); } });
  return <section ref={ref} tabIndex={0} aria-label={name} data-level={level}>
    <p data-reading-selection-source={name}>Source text</p><button>Action</button><input aria-label={`${name} note`} />
  </section>;
}
function wheel(target: Element, deltaY = 100, more: WheelEventInit = {}) {
  return fireEvent.wheel(target, { ctrlKey: true, deltaY, cancelable: true, ...more });
}

it('changes only the targeted paragraph and consumes Ctrl+wheel even at either limit', () => {
  const change = vi.fn();
  render(<><Paragraph name="first" change={change} /><Paragraph name="second" /></>);
  const first = screen.getByRole('region', { name: 'first' }), second = screen.getByRole('region', { name: 'second' });
  expect(wheel(first, -100)).toBe(false);
  expect(change).not.toHaveBeenCalled();
  for (const level of ['brief', 'key', 'takeaway', 'topic', 'topic']) {
    now += 300; expect(wheel(first)).toBe(false); expect(first.getAttribute('data-level')).toBe(level);
  }
  expect(change).toHaveBeenCalledTimes(4);
  expect(second.getAttribute('data-level')).toBe('full');
  expect(wheel(first, -100)).toBe(false);
  expect(first.getAttribute('data-level')).toBe('takeaway');
});

it('accumulates trackpad input, throttles bursts, and supports line and page wheel units', () => {
  render(<Paragraph name="trackpad" />);
  const paragraph = screen.getByRole('region');
  wheel(paragraph, 20); now += 10; wheel(paragraph, 20);
  expect(paragraph.getAttribute('data-level')).toBe('full');
  now += 10; wheel(paragraph, 20);
  expect(paragraph.getAttribute('data-level')).toBe('brief');
  now += 10; wheel(paragraph, 100);
  expect(paragraph.getAttribute('data-level')).toBe('brief');
  now += 300; wheel(paragraph, 3, { deltaMode: 1 });
  expect(paragraph.getAttribute('data-level')).toBe('key');
  now += 300; wheel(paragraph, 1, { deltaMode: 2 });
  expect(paragraph.getAttribute('data-level')).toBe('takeaway');
});

it('leaves normal scrolling, other modifiers, interactive controls and pointer drags alone', () => {
  const change = vi.fn(); render(<Paragraph name="protected" change={change} />);
  const paragraph = screen.getByRole('region');
  for (const options of [{ ctrlKey: false }, { altKey: true }, { shiftKey: true }, { metaKey: true }, { buttons: 1 }, { deltaX: 200 }]) {
    expect(wheel(paragraph, 100, options)).toBe(true);
  }
  expect(wheel(screen.getByRole('button'))).toBe(true);
  expect(wheel(screen.getByRole('textbox'))).toBe(true);
  const range = document.createRange(); range.selectNodeContents(paragraph.querySelector('p')!);
  window.getSelection()?.addRange(range);
  expect(wheel(paragraph)).toBe(true);
  expect(change).not.toHaveBeenCalled();
});

it('supports focused Ctrl+arrows without stealing editing or the existing plain arrow keys', () => {
  render(<Paragraph name="keyboard" initial="key" />);
  const paragraph = screen.getByRole('region');
  expect(fireEvent.keyDown(paragraph, { key: 'ArrowUp', ctrlKey: true })).toBe(false);
  expect(paragraph.getAttribute('data-level')).toBe('brief');
  fireEvent.keyDown(paragraph, { key: 'ArrowDown', ctrlKey: true, repeat: true });
  expect(paragraph.getAttribute('data-level')).toBe('brief');
  expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowDown', ctrlKey: true })).toBe(true);
  expect(fireEvent.keyDown(paragraph, { key: 'ArrowDown' })).toBe(true);
  fireEvent.keyDown(paragraph, { key: 'ArrowDown', ctrlKey: true });
  expect(paragraph.getAttribute('data-level')).toBe('key');
});

it('releases listeners when folding is unavailable or the paragraph unmounts', () => {
  const change = vi.fn();
  const view = render(<Paragraph name="lifecycle" change={change} />);
  const paragraph = screen.getByRole('region');
  view.rerender(<Paragraph name="lifecycle" change={change} enabled={false} />);
  expect(wheel(paragraph)).toBe(true);
  view.rerender(<Paragraph name="lifecycle" change={change} />);
  expect(wheel(paragraph)).toBe(false);
  expect(change).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(wheel(paragraph)).toBe(true);
  expect(change).toHaveBeenCalledTimes(1);
});
