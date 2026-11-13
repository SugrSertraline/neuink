// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LibraryTabHoverSwitch } from './LibraryTabHoverSwitch';
afterEach(cleanup);
it('follows the current view and offers keyboard-accessible quick navigation', () => {
  const onSwitch = vi.fn();
  const view = render(<LibraryTabHoverSwitch navigation={{view:'recent',title:'最近阅读',onSwitch}} dragging={false} pinned={false} onSelect={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole('button',{name:'最近阅读'}),{key:'ArrowDown'});
  fireEvent.click(screen.getByRole('button',{name:'回收站'}));
  expect(onSwitch).toHaveBeenCalledWith('trash');
  view.rerender(<LibraryTabHoverSwitch navigation={{view:'trash',title:'回收站',onSwitch}} dragging={false} pinned={false} onSelect={vi.fn()} />);
  expect(screen.getByRole('button',{name:'回收站'})).toBeTruthy();
  expect(screen.queryByText('条目库 · 快速切换')).toBeNull();
});
it('suppresses the popup while dragging a tab', () => {
  render(<LibraryTabHoverSwitch navigation={{view:'all',title:'全部条目',onSwitch:vi.fn()}} dragging pinned={false} onSelect={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole('button',{name:'全部条目'}),{key:'ArrowDown'});
  expect(screen.queryByText('条目库 · 快速切换')).toBeNull();
});
