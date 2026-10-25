// @vitest-environment jsdom
import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hoverInteractionBlocked } from '@/components/ui/hover-interactions';
import { usePdfTextSelection } from './usePdfTextSelection';
import type { PageSegments } from './types';

const page: PageSegments = { pageIdx: 0, segments: [], regions: [] };
function Reader({ enabled = true }: { enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const selection = usePdfTextSelection(ref, page, enabled);
  return <><div ref={ref} data-testid="page" onPointerDown={selection.begin} onPointerUp={selection.finish}>
    <div className="pdf-text-layer"><span>First passage and second passage</span></div>
  </div><button onClick={selection.close}>关闭</button><p>Other pane text</p>
    {selection.pending && <div data-reading-selection-toolbar>
      <output data-rects={JSON.stringify(selection.pending.selection.rects)}>{selection.pending.selection.text}</output><textarea aria-label="批注" />
    </div>}</>;
}
function select(text = 'First passage and second passage', start = 0, end = 5) {
  const node = screen.getByText(text).firstChild!;
  const range = document.createRange();
  range.setStart(node, start); range.setEnd(node, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges(); selection.addRange(range);
  fireEvent(document, new Event('selectionchange'));
}
function tick() { act(() => vi.advanceTimersByTime(30)); }
function setup() {
  const ui = render(<Reader />);
  vi.spyOn(screen.getByTestId('page'), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 700));
  return ui;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [new DOMRect(10, 20, 100, 15)] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(10, 20, 100, 15) });
});
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('ends native selection and releases hover on Escape while focus remains in the reader', () => {
  setup(); select(); tick();
  expect(screen.getByRole('status').textContent).toBe('First');
  expect(hoverInteractionBlocked()).toBe(true);
  fireEvent.keyDown(document.body, { key: 'Escape' });
  expect(screen.queryByRole('status')).toBeNull();
  expect(window.getSelection()?.isCollapsed).toBe(true);
  expect(hoverInteractionBlocked()).toBe(false);
});

it('normalizes edge highlights against the PDF content rather than its decorative border', () => {
  setup();
  const layer = screen.getByTestId('page').querySelector('.pdf-text-layer')!;
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(new DOMRect(2, 2, 500, 700));
  vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue([new DOMRect(2, 2, 100, 15)] as unknown as DOMRectList);
  select(); tick();
  expect(JSON.parse(screen.getByRole('status').getAttribute('data-rects')!)).toEqual([[0, 0, 200, 21.43]]);
});

it('cancels a queued capture when a new drag starts and captures only after release', () => {
  setup(); select();
  fireEvent.pointerDown(screen.getByTestId('page'), { button: 0, buttons: 1 });
  tick();
  expect(screen.queryByRole('status')).toBeNull();
  select('First passage and second passage', 18, 24); tick();
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.pointerUp(window, { button: 0 }); tick();
  expect(screen.getByRole('status').textContent).toBe('second');
});

it('does not publish a partial selection when the document scrolls during a held drag', () => {
  setup();
  fireEvent.pointerDown(screen.getByTestId('page'), { button: 0, buttons: 1 });
  select();
  fireEvent.scroll(document);
  select('First passage and second passage', 0, 13); tick();
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.pointerUp(window, { button: 0 }); tick();
  expect(screen.getByRole('status').textContent).toBe('First passage');
});

it('ignores scrolling in another pane and cancels capture after unmount', () => {
  const ui = setup(); select(); tick();
  fireEvent.scroll(screen.getByText('Other pane text'));
  expect(screen.getByRole('status').textContent).toBe('First');
  select('First passage and second passage', 0, 13);
  ui.unmount(); tick();
  expect(screen.queryByRole('status')).toBeNull();
});

it.each(['blur', 'pointercancel', 'neuink:reader-surface-change'])('cancels delayed work on %s', type => {
  setup(); select();
  fireEvent(window, new Event(type)); tick();
  expect(screen.queryByRole('status')).toBeNull();
});

it('keeps the selected excerpt while editing the portalled annotation', () => {
  setup(); select(); tick();
  const input = screen.getByLabelText('批注');
  fireEvent.pointerDown(input, { button: 0, buttons: 1 });
  act(() => { input.focus(); window.getSelection()?.removeAllRanges(); });
  fireEvent(document, new Event('selectionchange')); tick();
  expect(screen.getByRole('status').textContent).toBe('First');
  fireEvent.scroll(input);
  expect(screen.getByRole('status').textContent).toBe('First');
});

it('clears stale tools when clicking elsewhere and never clears another pane selection', () => {
  setup(); select(); tick();
  fireEvent.pointerDown(screen.getByText('Other pane text'), { button: 0 });
  expect(screen.queryByRole('status')).toBeNull();
  select('Other pane text', 0, 5);
  fireEvent.click(screen.getByText('关闭')); tick();
  expect(window.getSelection()?.toString()).toBe('Other');
});

it('captures keyboard selections when translation is available without annotation', () => {
  setup(); select(); tick();
  expect(screen.getByRole('status').textContent).toBe('First');
  select('First passage and second passage', 0, 13); tick();
  expect(screen.getByRole('status').textContent).toBe('First passage');
});
