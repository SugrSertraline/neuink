// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadingViewSession, PdfViewControls, publishReadingView, subscribeReadingView } from './ReadingViewSession';
afterEach(() => { cleanup(); localStorage.clear(); });
it('remembers the display mode across restarts without sharing it with another view or workspace', () => {
  const view = (root = 'a', viewId?: string) => <ReadingViewSession workspaceRoot={root} active surface={{ kind: 'pdf', entryId: 'paper', viewId }}><PdfViewControls /></ReadingViewSession>;
  const ui = render(view());
  fireEvent.click(ui.getByRole('button', { name: '译文' }));
  ui.unmount();
  const reopened = render(view());
  expect(reopened.getByRole('button', { name: '译文' }).getAttribute('aria-pressed')).toBe('true');
  reopened.unmount();
  const other = render(view('b'));
  expect(other.getByRole('button', { name: '原文' }).getAttribute('aria-pressed')).toBe('true');
  other.unmount();
  const copied = render(view('a', 'copy'));
  expect(copied.getByRole('button', { name: '原文' }).getAttribute('aria-pressed')).toBe('true');
});
it('keeps display mode local while same-document position linking has no switch', () => {
  const result = render(<><section data-testid="a"><ReadingViewSession workspaceRoot="w" active surface={{ kind: 'pdf', entryId: 'a' }}><PdfViewControls />A</ReadingViewSession></section><section data-testid="b"><ReadingViewSession workspaceRoot="w" active surface={{ kind: 'pdf', entryId: 'a', viewId: 'copy' }}><PdfViewControls />B</ReadingViewSession></section></>);
  expect(result.queryByLabelText('阅读视图设置')).toBeNull();
  const a = within(result.getByTestId('a')), b = within(result.getByTestId('b'));
  fireEvent.click(b.getByRole('button', { name: '译文' }));
  expect(b.getByRole('button', { name: '译文' }).getAttribute('aria-pressed')).toBe('true');
  expect(a.getByRole('button', { name: '原文' }).getAttribute('aria-pressed')).toBe('true');
  expect(result.queryByRole('button', { name: '悬停译文' })).toBeNull();
  expect(result.queryByRole('button', { name: /定位联动/ })).toBeNull();
});
it('seeds a new peer from the current position and releases listeners on close', () => {
  const receiveA = vi.fn(), receiveB = vi.fn(), other = vi.fn();
  const position = { pageIdx: 8, segmentUid: 's', segmentOffset: .3, offset: .2, left: 0 };
  const offA = subscribeReadingView('document', { id: 'a', receive: receiveA, capture: () => position });
  const offB = subscribeReadingView('document', { id: 'b', receive: receiveB });
  const offOther = subscribeReadingView('other-workspace', { id: 'c', receive: other });
  expect(receiveB).toHaveBeenCalledWith(position);
  publishReadingView('document', 'a', position); expect(receiveA).not.toHaveBeenCalled(); expect(other).not.toHaveBeenCalled();
  offB(); receiveB.mockClear(); publishReadingView('document', 'a', position); expect(receiveB).not.toHaveBeenCalled();
  offA(); offOther();
});
